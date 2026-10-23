"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { toastError, toastPlanError } from "@/lib/notify-error";
import { Check, ChevronDown, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { positionAtEnd, positionForIndex, shoppingItemInputSchema, sortByPosition } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { usePresence } from "@/lib/realtime/presence";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { addShoppingItem, loadShoppingItems, removeShoppingItems, updateShoppingItem, type ShoppingItem } from "@/lib/data/lists";
import type { ItemRow } from "@/lib/data/items";
import { EditableTitle, useLiveItem } from "@/components/modules/collab-chrome";
import { SortableList } from "@/components/modules/sortable";
import { PageHeader } from "@/components/shell/page-header";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Avatar, AvatarStack, Badge, EmptyState, Notice } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Tooltip } from "@/components/ui/menu";
import { cn, errorMessage } from "@/lib/utils";

function qty(item: Pick<ShoppingItem, "quantity" | "unit">): string {
  const n = Number(item.quantity);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "")}${item.unit ? ` ${item.unit}` : ""}`;
}

export function ShoppingView({ list, initialItems }: { list: ItemRow; initialItems: ShoppingItem[] }) {
  const router = useRouter();
  const { workspace, canEdit, href, member } = useWorkspace();
  const { online } = usePresence();
  const sb = getBrowserSupabase();
  const { item, deleted } = useLiveItem("shopping", list);
  const load = useCallback(() => loadShoppingItems(sb, list.id), [sb, list.id]);
  const { rows, setRows, reload, status } = useLiveRows({ table: "shopping_items", filter: `list_id=eq.${list.id}`, load, initial: initialItems });
  const open = useMemo(() => sortByPosition(rows.filter((r) => !r.checked)), [rows]);
  const done = useMemo(() => [...rows.filter((r) => r.checked)].sort((a, b) => ((b.checked_at ?? "") > (a.checked_at ?? "") ? 1 : -1)), [rows]);
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [showDone, setShowDone] = useState(true);
  const [clearing, setClearing] = useState(false);
  const viewers = online.filter((o) => o.location === `shopping/${list.id}`).map((o) => ({ id: o.userId, name: o.name, color: o.color }));

  if (deleted) {
    return (
      <EmptyState
        icon={<ListTodo />}
        title="This list was deleted"
        action={<Button variant="outline" onClick={() => router.push(href("shopping"))}>Back to lists</Button>}
      />
    );
  }

  const patch = async (id: string, p: Parameters<typeof updateShoppingItem>[2]) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...(p.checked !== undefined ? { checked: p.checked } : {}), ...(p.position ? { position: p.position } : {}) } : x)));
    try {
      const saved = await updateShoppingItem(sb, id, p);
      // Responses can arrive out of order; keep whichever copy is newer.
      setRows((r) => r.map((x) => (x.id === id && saved.version >= x.version ? saved : x)));
    } catch (err) {
      toastError(err);
      void reload();
    }
  };

  const renderRow = (it: ShoppingItem, handle: React.ReactNode) => {
    const assignee = member(it.assignee_id);
    const checker = member(it.checked_by);
    return (
      <div className="group flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2 last:border-b-0">
        {handle}
        <button
          role="checkbox"
          aria-checked={it.checked}
          aria-label={`${it.checked ? "Uncheck" : "Check"} ${it.name}`}
          disabled={!canEdit}
          onClick={() => void patch(it.id, { checked: !it.checked })}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
            it.checked ? "border-success bg-success text-white" : "border-border-strong hover:border-success",
          )}
        >
          {it.checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[14px] text-text", it.checked && "text-muted line-through")}>{it.name}</p>
          {it.checked && checker ? <p className="text-[11.5px] text-muted">Done by {checker.name}</p> : null}
        </div>
        <span className="font-mono text-[12.5px] text-text-2 tabular-nums">{qty(it)}</span>
        {it.category ? <Badge>{it.category}</Badge> : null}
        {assignee ? (
          <Tooltip label={`Assigned to ${assignee.name}`}>
            <span>
              <Avatar name={assignee.name} color={assignee.color} size={22} />
            </span>
          </Tooltip>
        ) : null}
        {canEdit ? (
          <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${it.name}`} onClick={() => setEditing(it)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${it.name}`}
              className="text-danger hover:bg-danger-soft"
              onClick={async () => {
                setRows((r) => r.filter((x) => x.id !== it.id));
                try {
                  await removeShoppingItems(sb, [it.id]);
                } catch (err) {
                  toastError(err);
                  void reload();
                }
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader
        crumbs={[{ label: workspace.name, href: href() }, { label: "TODO List", href: href("shopping") }]}
        icon={<ModuleIcon type="shopping" tile />}
        title={<EditableTitle module="shopping" item={item} editable={canEdit} />}
        meta={`${open.length} to do · ${done.length} done${status === "reconnecting" ? " · reconnecting…" : ""}`}
        actions={viewers.length ? <AvatarStack people={viewers} size={24} /> : null}
      />
      <div className="flex flex-col gap-5 px-6 lg:px-10">
        {canEdit ? (
          <QuickAdd
            categories={categories}
            onAdd={async (input) => {
              const added = await addShoppingItem(sb, { workspaceId: workspace.id, listId: list.id }, input, positionAtEnd(open));
              setRows((r) => (r.some((x) => x.id === added.id) ? r : [...r, added]));
            }}
          />
        ) : null}

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong">
            <EmptyState icon={<ListTodo />} title="Nothing to do yet" description="Add tasks above. Check them off as you go — everyone sees it instantly." />
          </div>
        ) : (
          <>
            {open.length ? (
              <SortableList
                items={open}
                disabled={!canEdit}
                className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
                onMove={(id, to) => void patch(id, { position: positionForIndex(open, to, id) })}
                render={(it, handle) => renderRow(it, handle)}
              />
            ) : (
              <Notice tone="success">Everything&apos;s done.</Notice>
            )}
            {done.length ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <button onClick={() => setShowDone((s) => !s)} aria-expanded={showDone} className="flex items-center gap-1 text-[13px] font-medium text-text-2 hover:text-text">
                    <ChevronDown className={cn("size-4 transition-transform", !showDone && "-rotate-90")} />
                    Done ({done.length})
                  </button>
                  {canEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => setClearing(true)}>
                      Clear done
                    </Button>
                  ) : null}
                </div>
                {showDone ? (
                  <ul className="overflow-hidden rounded-xl border border-border bg-surface">
                    {done.map((it) => (
                      <li key={it.id}>{renderRow(it, <span className="w-6" />)}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>

      <EditItemDialog item={editing} categories={categories} onClose={() => setEditing(null)} onSave={async (id, p) => void (await patch(id, p))} />
      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title={`Remove ${done.length} checked item${done.length === 1 ? "" : "s"}?`}
        confirmLabel="Clear done"
        destructive
        onConfirm={async () => {
          const ids = done.map((d) => d.id);
          setRows((r) => r.filter((x) => !ids.includes(x.id)));
          try {
            await removeShoppingItems(sb, ids);
          } catch (err) {
            void reload();
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </div>
  );
}

function QuickAdd({ categories, onAdd }: { categories: string[]; onAdd: (input: { name: string; quantity: number; unit: string; category: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = shoppingItemInputSchema.safeParse({ name, quantity, unit, category });
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Check the item");
          return;
        }
        setBusy(true);
        try {
          await onAdd({ name: parsed.data.name, quantity: parsed.data.quantity, unit: parsed.data.unit, category: parsed.data.category });
          setName("");
          setQuantity("1");
          setUnit("");
          ref.current?.focus();
        } catch (err) {
          toastError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input ref={ref} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Add a task…" aria-label="Task name" className="min-w-40 flex-[3]" />
      <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" min="0.01" max="9999" step="any" aria-label="Quantity" className="w-20" />
      <Input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={16} placeholder="unit" aria-label="Unit" className="w-24" />
      <Input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} placeholder="Category" aria-label="Category" list="shopping-categories" className="w-32" />
      <datalist id="shopping-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
        <Plus className="size-4" /> Add
      </Button>
    </form>
  );
}

function EditItemDialog({
  item,
  categories,
  onClose,
  onSave,
}: {
  item: ShoppingItem | null;
  categories: string[];
  onClose: () => void;
  onSave: (id: string, p: Parameters<typeof updateShoppingItem>[2]) => Promise<void>;
}) {
  const { members } = useWorkspace();
  const [draft, setDraft] = useState({ name: "", quantity: "1", unit: "", category: "", assigneeId: "" });
  const [shownId, setShownId] = useState<string | null>(null);
  if (item && item.id !== shownId) {
    setShownId(item.id);
    setDraft({ name: item.name, quantity: String(item.quantity), unit: item.unit, category: item.category, assigneeId: item.assignee_id ?? "" });
  }
  if (!item && shownId) setShownId(null);
  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit task">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!item) return;
            const parsed = shoppingItemInputSchema.safeParse({ ...draft, assigneeId: draft.assigneeId || null });
            if (!parsed.success) {
              toast.error(parsed.error.issues[0]?.message ?? "Check the fields");
              return;
            }
            await onSave(item.id, parsed.data);
            onClose();
          }}
        >
          <Field label="Name">{(p) => <Input {...p} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} required />}</Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantity">
              {(p) => <Input {...p} type="number" min="0.01" max="9999" step="any" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />}
            </Field>
            <Field label="Unit">{(p) => <Input {...p} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} maxLength={16} />}</Field>
            <Field label="Category">
              {(p) => <Input {...p} value={draft.category} list="shopping-categories-edit" onChange={(e) => setDraft({ ...draft, category: e.target.value })} maxLength={40} />}
            </Field>
            <datalist id="shopping-categories-edit">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <Field label="Assigned to">
            {(p) => (
              <Select {...p} value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}>
                <option value="">Anyone</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
