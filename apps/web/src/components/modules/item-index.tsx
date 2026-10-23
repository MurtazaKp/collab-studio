"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { toastPlanError } from "@/lib/notify-error";
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { MODULES } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { usePresence } from "@/lib/realtime/presence";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { ITEM_TABLE, createItem, deleteItem, listItems, renameItem, type ItemModule, type ItemRow } from "@/lib/data/items";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { AvatarStack, EmptyState, Skeleton } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog, PromptDialog } from "@/components/ui/confirm";
import { ModuleIcon, MODULE_ICONS } from "@/components/ui/module-icon";
import { errorMessage, timeAgo } from "@/lib/utils";

const EMPTY_COPY: Record<ItemModule, string> = {
  docs: "Write specs, notes and plans together. Everyone's cursor shows up live.",
  whiteboard: "Sketch, drop sticky notes and connect ideas on an infinite canvas.",
  kanban: "Track work across columns. Cards move for everyone the moment you drag them.",
  mindmap: "Start from a central topic and branch out together.",
  code: "Share a Monaco editor with syntax highlighting. Code is never executed.",
  playlist: "Collect tracks and links, then order them as a group.",
  shopping: "Shared to-do lists with assignees and check-offs. Everyone sees progress instantly.",
};

export function ItemIndex({ module, initial }: { module: ItemModule; initial: ItemRow[] }) {
  const router = useRouter();
  const { workspace, canEdit, member, href } = useWorkspace();
  const { online } = usePresence();
  const def = MODULES[module];
  const table = ITEM_TABLE[module];
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ItemRow | null>(null);
  const [deleting, setDeleting] = useState<ItemRow | null>(null);

  const load = useCallback(() => listItems(getBrowserSupabase(), table, workspace.id), [table, workspace.id]);
  const { rows, status } = useLiveRows({
    table,
    filter: `workspace_id=eq.${workspace.id}`,
    load: load as never,
    initial: initial as never,
  });
  const items = (rows as unknown as ItemRow[])
    .filter((r) => !query || r.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => ((b.content_updated_at ?? b.updated_at) > (a.content_updated_at ?? a.updated_at) ? 1 : -1));

  const viewers = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }[]>();
    for (const o of online) {
      const [seg, id] = o.location.split("/");
      if (seg !== def.segment || !id) continue;
      map.set(id, [...(map.get(id) ?? []), { id: o.userId, name: o.name, color: o.color }]);
    }
    return map;
  }, [online, def.segment]);

  const Icon = MODULE_ICONS[module];
  const noun = def.itemNoun;

  return (
    <div className="mx-auto max-w-5xl pb-16">
      <PageHeader
        crumbs={[{ label: workspace.name, href: href() }, { label: def.label }]}
        icon={<ModuleIcon type={module} tile />}
        title={def.label}
        meta={def.description}
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New {noun}
            </Button>
          ) : null
        }
      />
      <div className="px-6 lg:px-10">
        {rows.length > 6 ? (
          <div className="relative mb-4 max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}s`} className="pl-8" aria-label={`Search ${noun}s`} />
          </div>
        ) : null}

        {status === "loading" && rows.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border-strong">
            <EmptyState
              icon={<Icon />}
              title={query ? "Nothing matches" : `No ${noun}s yet`}
              description={query ? "Try a different search." : EMPTY_COPY[module]}
              action={
                canEdit && !query ? (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus className="size-4" /> Create the first {noun}
                  </Button>
                ) : null
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const author = member(item.last_edited_by ?? item.created_by);
              const here = viewers.get(item.id) ?? [];
              return (
                <li key={item.id} className="group relative">
                  <Link
                    href={href(`${def.segment}/${item.id}`)}
                    className="flex h-full min-h-28 flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md"
                  >
                    <div className="flex items-start gap-2 pr-7">
                      <span className="line-clamp-2 text-[14.5px] font-semibold text-text">{item.title}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 flex-1 text-[13px] leading-relaxed text-muted">
                      {item.preview_text || item.description || " "}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[12px] text-muted">
                      <span className="truncate">
                        {author ? `${author.name} · ` : ""}
                        {timeAgo(item.content_updated_at ?? item.updated_at)}
                      </span>
                      {here.length ? <AvatarStack people={here} size={18} max={3} /> : null}
                    </div>
                  </Link>
                  {canEdit ? (
                    <div className="absolute top-3 right-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${item.title}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem icon={<Pencil />} onSelect={() => setRenaming(item)}>
                            Rename
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(item)}>
                            Delete
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PromptDialog
        open={creating}
        onOpenChange={setCreating}
        title={`New ${noun}`}
        label="Title"
        placeholder={`Untitled ${noun}`}
        submitLabel="Create"
        onSubmit={async (title) => {
          try {
            const row = await createItem(getBrowserSupabase(), module, workspace.id, title);
            router.push(href(`${def.segment}/${row.id}`));
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
      <PromptDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title={`Rename ${noun}`}
        label="Title"
        initialValue={renaming?.title ?? ""}
        onSubmit={async (title) => {
          try {
            await renameItem(getBrowserSupabase(), table, renaming!.id, title);
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ""}”?`}
        description={`This permanently deletes the ${noun} and its content for everyone in ${workspace.name}.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await deleteItem(getBrowserSupabase(), table, deleting!.id);
            toast.success(`Deleted ${noun}`);
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </div>
  );
}
