"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { toastError, toastPlanError } from "@/lib/notify-error";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { positionAtEnd, positionForIndex, sortByPosition, type TaskPriority } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { ConflictError, addColumn, createTask, deleteColumn, loadColumns, loadTasks, moveTask, updateColumn, type Column, type Task } from "@/lib/data/kanban";
import type { ItemRow } from "@/lib/data/items";
import { EditableTitle, useLiveItem } from "@/components/modules/collab-chrome";
import { PageHeader } from "@/components/shell/page-header";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Avatar, AvatarStack, Badge } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog, PromptDialog } from "@/components/ui/confirm";
import { usePresence } from "@/lib/realtime/presence";
import { cn, errorMessage, formatDate } from "@/lib/utils";
import { TaskDialog } from "./task-dialog";

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: "neutral" | "accent" | "warning" | "danger" | "success"; dot: string }> = {
  none: { label: "No priority", tone: "neutral", dot: "transparent" },
  low: { label: "Low", tone: "success", dot: "var(--success)" },
  medium: { label: "Medium", tone: "accent", dot: "var(--accent)" },
  high: { label: "High", tone: "warning", dot: "var(--warning)" },
  urgent: { label: "Urgent", tone: "danger", dot: "var(--danger)" },
};

type Layout = Record<string, string[]>;

export function KanbanBoard({ board, initialColumns, initialTasks }: { board: ItemRow; initialColumns: Column[]; initialTasks: Task[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { workspace, canEdit, href } = useWorkspace();
  const { online } = usePresence();
  const sb = getBrowserSupabase();
  const { item, deleted } = useLiveItem("kanban", board);

  const loadCols = useCallback(() => loadColumns(sb, board.id), [sb, board.id]);
  const loadTsk = useCallback(() => loadTasks(sb, board.id), [sb, board.id]);
  const cols = useLiveRows({ table: "board_columns", filter: `board_id=eq.${board.id}`, load: loadCols, initial: initialColumns });
  const tasks = useLiveRows({ table: "tasks", filter: `board_id=eq.${board.id}`, load: loadTsk, initial: initialTasks });

  const columns = useMemo(() => sortByPosition(cols.rows), [cols.rows]);
  const taskById = useMemo(() => new Map(tasks.rows.map((t) => [t.id, t])), [tasks.rows]);
  const baseLayout = useMemo<Layout>(() => {
    const out: Layout = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
    for (const t of sortByPosition(tasks.rows)) out[t.column_id]?.push(t.id);
    return out;
  }, [columns, tasks.rows]);

  const [dragLayout, setDragLayout] = useState<Layout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const layout = dragLayout ?? baseLayout;
  const openTaskId = search.get("task");
  const tasksRef = useRef(tasks.rows);
  useEffect(() => {
    tasksRef.current = tasks.rows;
  }, [tasks.rows]);
  // Moves of the same card run one after another with the latest version, so a
  // quick second drag doesn't look like someone else's edit.
  const moveQueue = useRef(new Map<string, Promise<void>>());

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Long-press to drag on touch screens, so a normal swipe still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    // Space picks up / drops; Enter is left free to open the card.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const viewers = online.filter((o) => o.location === `kanban/${board.id}`).map((o) => ({ id: o.userId, name: o.name, color: o.color }));

  const columnOf = (id: string, l: Layout) => Object.keys(l).find((c) => l[c]!.includes(id));

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    if (String(e.active.id).startsWith("task:")) setDragLayout(structuredClone(baseLayout));
  };

  const onDragOver = (e: DragOverEvent) => {
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    if (!a.startsWith("task:") || !o) return;
    setDragLayout((l) => {
      if (!l) return l;
      const taskId = a.slice(5);
      const from = columnOf(taskId, l);
      const to = o.startsWith("col:") ? o.slice(4) : columnOf(o.slice(5), l);
      if (!from || !to || from === to) return l;
      const next = { ...l, [from]: l[from]!.filter((x) => x !== taskId), [to]: [...l[to]!] };
      const overIndex = o.startsWith("task:") ? next[to]!.indexOf(o.slice(5)) : next[to]!.length;
      next[to]!.splice(overIndex < 0 ? next[to]!.length : overIndex, 0, taskId);
      return next;
    });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    setActiveId(null);
    const l = dragLayout;
    setDragLayout(null);
    if (!o) return;

    if (a.startsWith("col:")) {
      const ids = columns.map((c) => c.id);
      const from = ids.indexOf(a.slice(4));
      const to = ids.indexOf(o.startsWith("col:") ? o.slice(4) : (taskById.get(o.slice(5))?.column_id ?? ""));
      if (from < 0 || to < 0 || from === to) return;
      const position = positionForIndex(columns, to, a.slice(4));
      cols.setRows((rows) => rows.map((c) => (c.id === a.slice(4) ? { ...c, position } : c)));
      try {
        await updateColumn(sb, a.slice(4), { position });
      } catch (err) {
        toastError(err);
        void cols.reload();
      }
      return;
    }

    if (!a.startsWith("task:") || !l) return;
    const taskId = a.slice(5);
    const task = taskById.get(taskId);
    const colId = columnOf(taskId, l);
    if (!task || !colId) return;
    let ids = l[colId]!;
    if (o.startsWith("task:")) {
      const oldIndex = ids.indexOf(taskId);
      const newIndex = ids.indexOf(o.slice(5));
      if (oldIndex >= 0 && newIndex >= 0) ids = arrayMove(ids, oldIndex, newIndex);
    }
    const index = ids.indexOf(taskId);
    const inColumn = tasks.rows.filter((t) => t.column_id === colId);
    // Dropped back where it was: nothing to save.
    if (task.column_id === colId && sortByPosition(inColumn).findIndex((t) => t.id === taskId) === index) return;
    // Position relative to the *persisted* neighbours at the target index.
    const neighbours = ids.filter((id) => id !== taskId).map((id) => taskById.get(id)!).filter(Boolean);
    const position = positionForIndex(neighbours.length ? neighbours : inColumn, index, taskId);
    if (task.column_id === colId && task.position === position) return;

    tasks.setRows((rows) => rows.map((t) => (t.id === taskId ? { ...t, column_id: colId, position } : t)));
    const run = async () => {
      const current = tasksRef.current.find((t) => t.id === taskId) ?? task;
      try {
        const saved = await moveTask(sb, current, colId, position);
        tasks.setRows((rows) => rows.map((t) => (t.id === taskId ? saved : t)));
      } catch (err) {
        if (err instanceof ConflictError) toast.error(err.message);
        else toastError(err);
        void tasks.reload();
      }
    };
    const next = (moveQueue.current.get(taskId) ?? Promise.resolve()).then(run, run);
    moveQueue.current.set(taskId, next);
    await next;
  };

  // A link to a card that no longer exists (deleted, or a stale ?task= link).
  useEffect(() => {
    if (openTaskId && tasks.status === "live" && !taskById.has(openTaskId)) {
      toast.message("That card no longer exists.");
      const params = new URLSearchParams(search.toString());
      params.delete("task");
      router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    }
  }, [openTaskId, tasks.status, taskById, search, router, pathname]);

  const openTask = (id: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (id) params.set("task", id);
    else params.delete("task");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const activeTask = activeId?.startsWith("task:") ? taskById.get(activeId.slice(5)) : null;
  const activeColumn = activeId?.startsWith("col:") ? columns.find((c) => c.id === activeId.slice(4)) : null;

  if (deleted) {
    return (
      <div className="p-10 text-center text-muted">
        This board was deleted.{" "}
        <button className="underline" onClick={() => router.push(href("kanban"))}>
          Back to boards
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        compact
        className="border-b border-border bg-surface"
        crumbs={[{ label: workspace.name, href: href() }, { label: "Kanban", href: href("kanban") }]}
        icon={<ModuleIcon type="kanban" tile />}
        title={<EditableTitle module="kanban" item={item} editable={canEdit} />}
        actions={
          <>
            {cols.status === "reconnecting" || tasks.status === "reconnecting" ? <span className="text-[12.5px] text-warning">Reconnecting…</span> : null}
            {viewers.length ? <AvatarStack people={viewers} size={24} /> : null}
          </>
        }
      />
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => {
        setActiveId(null);
        setDragLayout(null);
      }}>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full items-start gap-3 p-4 lg:p-5">
            <SortableContext items={columns.map((c) => `col:${c.id}`)} strategy={horizontalListSortingStrategy}>
              {columns.map((c) => (
                <ColumnView
                  key={c.id}
                  column={c}
                  taskIds={layout[c.id] ?? []}
                  taskById={taskById}
                  editable={canEdit}
                  onOpenTask={openTask}
                  onAddTask={async (title) => {
                    const position = positionAtEnd(tasks.rows.filter((t) => t.column_id === c.id));
                    try {
                      const t = await createTask(sb, { workspaceId: workspace.id, boardId: board.id, columnId: c.id, title, position });
                      tasks.setRows((rows) => (rows.some((r) => r.id === t.id) ? rows : [...rows, t]));
                    } catch (err) {
                      toastError(err);
                      throw err; // keep the typed title in the form
                    }
                  }}
                  onRename={async (title) => {
                    await updateColumn(sb, c.id, { title });
                    cols.setRows((rows) => rows.map((r) => (r.id === c.id ? { ...r, title } : r)));
                  }}
                  onDelete={async () => {
                    await deleteColumn(sb, c.id);
                    cols.setRows((rows) => rows.filter((r) => r.id !== c.id));
                  }}
                />
              ))}
            </SortableContext>
            {canEdit ? (
              <AddColumn
                onAdd={async (title) => {
                  try {
                    const col = await addColumn(sb, workspace.id, board.id, title, positionAtEnd(columns));
                    cols.setRows((rows) => (rows.some((r) => r.id === col.id) ? rows : [...rows, col]));
                  } catch (err) {
                    toastError(err);
                  }
                }}
              />
            ) : null}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" }}>
          {activeTask ? <TaskCardView task={activeTask} overlay /> : null}
          {activeColumn ? (
            <div className="w-72 rounded-xl border border-border bg-surface-2 p-3 text-[13.5px] font-semibold shadow-lg">{activeColumn.title}</div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openTaskId && taskById.get(openTaskId) ? (
        <TaskDialog
          task={taskById.get(openTaskId)!}
          columns={columns}
          onClose={() => openTask(null)}
          onSaved={(t) => tasks.setRows((rows) => rows.map((r) => (r.id === t.id ? t : r)))}
          onConflict={() => void tasks.reload()}
          onDeleted={(id) => {
            tasks.setRows((rows) => rows.filter((r) => r.id !== id));
            openTask(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ColumnView({
  column,
  taskIds,
  taskById,
  editable,
  onOpenTask,
  onAddTask,
  onRename,
  onDelete,
}: {
  column: Column;
  taskIds: string[];
  taskById: Map<string, Task>;
  editable: boolean;
  onOpenTask: (id: string) => void;
  onAddTask: (title: string) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const sortable = useSortable({ id: `col:${column.id}`, data: { type: "column" }, disabled: !editable });
  const { setNodeRef: setDropRef } = useDroppable({ id: `col:${column.id}` });
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);

  return (
    <section
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cn("flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-surface-2", sortable.isDragging && "opacity-40")}
      aria-label={`${column.title} column`}
    >
      <header className="flex items-center gap-1 px-2 pt-2 pb-1">
        {editable ? (
          <button {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder ${column.title}`} className="cursor-grab rounded p-1.5 text-muted hover:bg-surface-3 active:cursor-grabbing">
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <h2 className="flex-1 truncate px-1 text-[13.5px] font-semibold text-text">{column.title}</h2>
        <span className="font-mono text-[11.5px] text-muted">{taskIds.length}</span>
        {editable ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${column.title} options`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
                Rename column
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} destructive onSelect={() => setDeleting(true)}>
                Delete column
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </header>
      <div ref={setDropRef} className="flex min-h-12 flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2">
        <SortableContext items={taskIds.map((id) => `task:${id}`)} strategy={verticalListSortingStrategy}>
          {taskIds.map((id) => {
            const t = taskById.get(id);
            return t ? <SortableTask key={id} task={t} editable={editable} onOpen={() => onOpenTask(id)} /> : null;
          })}
        </SortableContext>
        {adding ? (
          <AddTaskForm
            onCancel={() => setAdding(false)}
            onAdd={async (title) => {
              await onAddTask(title);
            }}
          />
        ) : editable ? (
          <button onClick={() => setAdding(true)} className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted transition-colors hover:bg-surface-3 hover:text-text">
            <Plus className="size-4" /> Add card
          </button>
        ) : taskIds.length === 0 ? (
          <p className="px-2 py-3 text-center text-[12.5px] text-muted">No cards</p>
        ) : null}
      </div>
      <PromptDialog open={renaming} onOpenChange={setRenaming} title="Rename column" label="Column name" initialValue={column.title} maxLength={60} onSubmit={onRename} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${column.title}”?`}
        description={taskIds.length ? `Its ${taskIds.length} card${taskIds.length === 1 ? "" : "s"} will be deleted too.` : "This column is empty."}
        confirmLabel="Delete column"
        destructive
        onConfirm={async () => {
          try {
            await onDelete();
          } catch (err) {
            if (toastPlanError(err)) return;
            throw new Error(errorMessage(err));
          }
        }}
      />
    </section>
  );
}

function AddTaskForm({ onAdd, onCancel }: { onAdd: (title: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      className="rounded-lg border border-border bg-surface p-2 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        try {
          await onAdd(value.trim());
          setValue("");
        } catch {
          // The error was shown already; keep the text so nothing is lost.
        } finally {
          setBusy(false);
          ref.current?.focus();
        }
      }}
    >
      <Input
        ref={ref}
        autoFocus
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Card title"
        aria-label="New card title"
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Done
        </Button>
        <Button size="sm" variant="primary" type="submit" loading={busy} disabled={!value.trim()}>
          Add
        </Button>
      </div>
    </form>
  );
}

function AddColumn({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-10 w-72 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-border-strong px-3 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
      >
        <Plus className="size-4" /> Add column
      </button>
      <PromptDialog open={open} onOpenChange={setOpen} title="New column" label="Column name" placeholder="e.g. Review" maxLength={60} submitLabel="Add column" onSubmit={onAdd} />
    </>
  );
}

function SortableTask({ task, editable, onOpen }: { task: Task; editable: boolean; onOpen: () => void }) {
  const s = useSortable({ id: `task:${task.id}`, data: { type: "task" }, disabled: !editable });
  return (
    <div
      ref={s.setNodeRef}
      style={{ transform: CSS.Translate.toString(s.transform), transition: s.transition }}
      className={cn(s.isDragging && "opacity-30")}
      {...s.attributes}
      {...s.listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
          return;
        }
        s.listeners?.onKeyDown?.(e);
      }}
      role="button"
      aria-roledescription={editable ? "Draggable card. Press Enter to open, Space to move." : "Card"}
      aria-label={`${task.title}${task.due_date && new Date(`${task.due_date}T23:59:59`) < new Date() ? ", overdue" : ""}`}
    >
      <TaskCardView task={task} />
    </div>
  );
}

export function TaskCardView({ task, overlay = false }: { task: Task; overlay?: boolean }) {
  const { member } = useWorkspace();
  const assignee = member(task.assignee_id);
  const pr = PRIORITY_META[task.priority];
  const overdue = task.due_date ? new Date(`${task.due_date}T23:59:59`) < new Date() : false;
  return (
    <article
      className={cn(
        "cursor-pointer rounded-lg border border-border bg-surface p-3 text-left shadow-sm transition-[border-color,box-shadow] hover:border-border-strong",
        overlay && "rotate-1 cursor-grabbing shadow-lg",
      )}
    >
      {task.labels.length ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <Badge key={l}>{l}</Badge>
          ))}
        </div>
      ) : null}
      <p className="text-[13.5px] leading-snug font-medium text-text">{task.title}</p>
      {task.priority !== "none" || task.due_date || assignee || task.description ? (
        <div className="mt-2.5 flex items-center gap-2 text-[12px] text-muted">
          {task.priority !== "none" ? (
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: pr.dot }} />
              {pr.label}
            </span>
          ) : null}
          {task.due_date ? (
            <span className={cn("inline-flex items-center gap-1", overdue && "text-danger")}>
              <CalendarDays className="size-3.5" />
              {formatDate(task.due_date)}
            </span>
          ) : null}
          {task.description ? <MessageSquare className="size-3.5" role="img" aria-label="Has description" /> : null}
          <span className="flex-1" />
          {assignee ? <Avatar name={assignee.name} color={assignee.color} size={20} /> : null}
        </div>
      ) : null}
    </article>
  );
}
