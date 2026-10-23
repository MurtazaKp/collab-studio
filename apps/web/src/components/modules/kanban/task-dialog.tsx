"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toastError, toastPlanError } from "@/lib/notify-error";
import { Download, Paperclip, Send, Trash2, X } from "lucide-react";
import { TASK_PRIORITIES, type TaskInput, type TaskPriority } from "@collabverse/shared";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import {
  ConflictError,
  addComment,
  attachmentUrl,
  deleteAttachment,
  deleteComment,
  deleteTask,
  loadAttachments,
  loadComments,
  updateTask,
  type Column,
  type Task,
} from "@/lib/data/kanban";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Notice } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/confirm";
import { errorMessage, timeAgo } from "@/lib/utils";
import { PRIORITY_META } from "./board";

export function TaskDialog({
  task,
  columns,
  onClose,
  onSaved,
  onConflict,
  onDeleted,
}: {
  task: Task;
  columns: Column[];
  onClose: () => void;
  onSaved: (t: Task) => void;
  onConflict: () => void;
  onDeleted: (id: string) => void;
}) {
  const { canEdit, members, member, workspace, me, canManage } = useWorkspace();
  const sb = getBrowserSupabase();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [labelDraft, setLabelDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const latest = useRef(task);
  useEffect(() => {
    // Never step back to an older version than one we've already saved.
    if (task.version >= latest.current.version) latest.current = task;
  }, [task]);
  // Saves run one after another, each using the version returned by the last,
  // so two quick edits (e.g. title then priority) don't conflict with each other.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  // Adopt remote changes to fields the user isn't actively editing.
  const editingField = useRef<string | null>(null);
  useEffect(() => {
    if (editingField.current !== "title") setTitle(task.title);
    if (editingField.current !== "description") setDescription(task.description);
  }, [task.title, task.description]);

  const save = (patch: Partial<TaskInput>) => {
    const run = async () => {
      try {
        const saved = await updateTask(sb, latest.current, patch);
        latest.current = saved;
        setConflict(false);
        onSaved(saved);
      } catch (err) {
        if (err instanceof ConflictError) {
          setConflict(true);
          onConflict();
        } else toastError(err);
      }
    };
    saveQueue.current = saveQueue.current.then(run, run);
    return saveQueue.current;
  };

  const column = columns.find((c) => c.id === task.column_id);
  const creator = member(task.created_by);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={canEdit ? "Edit card" : "Card"} description={`In ${column?.title ?? "a column"}${creator ? ` · created by ${creator.name}` : ""}`} wide>
        {conflict ? (
          <Notice tone="warning" className="mb-4">
            Someone else changed this card while you were editing. The latest version is shown — re-apply your change if it&apos;s still needed.
          </Notice>
        ) : null}
        <div className="grid gap-6 md:grid-cols-[1fr_200px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Field label="Title">
              {(p) => (
                <Input
                  {...p}
                  value={title}
                  readOnly={!canEdit}
                  maxLength={200}
                  onFocus={() => (editingField.current = "title")}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    editingField.current = null;
                    if (title.trim() && title.trim() !== task.title) void save({ title: title.trim() });
                    else setTitle(task.title);
                  }}
                />
              )}
            </Field>
            <Field label="Description">
              {(p) => (
                <Textarea
                  {...p}
                  rows={6}
                  value={description}
                  readOnly={!canEdit}
                  maxLength={10000}
                  placeholder={canEdit ? "Add details, acceptance criteria, links…" : "No description"}
                  onFocus={() => (editingField.current = "description")}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => {
                    editingField.current = null;
                    if (description !== task.description) void save({ description });
                  }}
                />
              )}
            </Field>
            <Attachments task={task} />
            <Comments task={task} />
          </div>

          <aside className="flex flex-col gap-4">
            <Field label="Assignee">
              {(p) => (
                <Select {...p} value={task.assignee_id ?? ""} disabled={!canEdit} onChange={(e) => void save({ assigneeId: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                      {m.userId === me.id ? " (you)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Priority">
              {(p) => (
                <Select {...p} value={task.priority} disabled={!canEdit} onChange={(e) => void save({ priority: e.target.value as TaskPriority })}>
                  {TASK_PRIORITIES.map((pr) => (
                    <option key={pr} value={pr}>
                      {PRIORITY_META[pr].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Due date">
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={task.due_date ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => void save({ dueDate: e.target.value || null })}
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-text-2">Labels</span>
              <div className="flex flex-wrap gap-1">
                {task.labels.map((l) => (
                  <Badge key={l}>
                    {l}
                    {canEdit ? (
                      <button aria-label={`Remove label ${l}`} onClick={() => void save({ labels: task.labels.filter((x) => x !== l) })}>
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </Badge>
                ))}
                {!task.labels.length && !canEdit ? <span className="text-[12.5px] text-muted">None</span> : null}
              </div>
              {canEdit && task.labels.length < 10 ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = labelDraft.trim().slice(0, 24);
                    if (!v || task.labels.includes(v)) return;
                    setLabelDraft("");
                    void save({ labels: [...task.labels, v] });
                  }}
                >
                  <Input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} maxLength={24} placeholder="Add label, press Enter" aria-label="New label" />
                </form>
              ) : null}
            </div>
            {canEdit ? (
              <Button variant="ghost" className="mt-2 justify-start text-danger hover:bg-danger-soft" onClick={() => setDeleting(true)}>
                <Trash2 className="size-4" /> Delete card
              </Button>
            ) : null}
            <p className="text-[11.5px] text-muted">
              Updated {timeAgo(task.updated_at)} · v{task.version}
              {canManage ? "" : ""}
            </p>
          </aside>
        </div>
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete this card?"
          description={`“${task.title}” and its comments will be deleted for everyone in ${workspace.name}.`}
          confirmLabel="Delete card"
          destructive
          onConfirm={async () => {
            try {
              await deleteTask(sb, task.id);
              onDeleted(task.id);
            } catch (err) {
              if (toastPlanError(err)) return;
              throw new Error(errorMessage(err));
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Comments({ task }: { task: Task }) {
  const { canEdit, member, workspace, me, canManage } = useWorkspace();
  const sb = getBrowserSupabase();
  const load = useCallback(() => loadComments(sb, task.id), [sb, task.id]);
  const { rows, setRows } = useLiveRows({ table: "comments", filter: `task_id=eq.${task.id}`, load });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  return (
    <section aria-label="Comments">
      <h3 className="mb-2 text-[13px] font-medium text-text-2">Comments</h3>
      <ul className="flex flex-col gap-3">
        {sorted.map((c) => {
          const author = member(c.author_id);
          return (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={author?.name ?? "Former member"} color={author?.color ?? "slate"} size={24} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-muted">
                  <span className="font-medium text-text">{author?.name ?? "Former member"}</span> · {timeAgo(c.created_at)}
                </p>
                <p className="mt-0.5 text-[13.5px] break-words whitespace-pre-wrap text-text">{c.body}</p>
              </div>
              {c.author_id === me.id || canManage ? (
                <button
                  aria-label="Delete comment"
                  className="self-start rounded p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100 [@media(hover:none)]:opacity-100"
                  onClick={async () => {
                    try {
                      await deleteComment(sb, c.id);
                      setRows((r) => r.filter((x) => x.id !== c.id));
                    } catch (err) {
                      toastError(err);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          );
        })}
        {!sorted.length ? <li className="text-[12.5px] text-muted">No comments yet.</li> : null}
      </ul>
      {canEdit ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!body.trim()) return;
            setBusy(true);
            try {
              const c = await addComment(sb, workspace.id, task.id, body);
              setRows((r) => (r.some((x) => x.id === c.id) ? r : [...r, c]));
              setBody("");
            } catch (err) {
              toastError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder="Write a comment…" aria-label="New comment" />
          <Button type="submit" variant="primary" size="icon" loading={busy} disabled={!body.trim()} aria-label="Post comment">
            {!busy ? <Send className="size-4" /> : null}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function Attachments({ task }: { task: Task }) {
  const { canEdit, workspace, me, canManage } = useWorkspace();
  const sb = getBrowserSupabase();
  const load = useCallback(() => loadAttachments(sb, task.id), [sb, task.id]);
  const { rows, setRows } = useLiveRows({ table: "attachments", filter: `task_id=eq.${task.id}`, load });
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <section aria-label="Attachments">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-text-2">Attachments</h3>
        {canEdit ? (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/zip"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                try {
                  const { uploadAttachment } = await import("@/lib/data/kanban");
                  const a = await uploadAttachment(sb, workspace.id, task.id, file);
                  setRows((r) => (r.some((x) => x.id === a.id) ? r : [...r, a]));
                } catch (err) {
                  toastError(err);
                } finally {
                  setUploading(false);
                }
              }}
            />
            <Button size="sm" variant="ghost" loading={uploading} onClick={() => input.current?.click()}>
              <Paperclip className="size-3.5" /> Attach file
            </Button>
          </>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="flex flex-col gap-1">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[13px]">
              <Paperclip className="size-3.5 text-muted" />
              <span className="min-w-0 flex-1 truncate text-text">{a.file_name}</span>
              <span className="font-mono text-[11px] text-muted">{Math.max(1, Math.round(a.size_bytes / 1024))} KB</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Download ${a.file_name}`}
                onClick={async () => {
                  try {
                    window.open(await attachmentUrl(sb, a), "_blank", "noopener,noreferrer");
                  } catch (err) {
                    toastError(err);
                  }
                }}
              >
                <Download className="size-3.5" />
              </Button>
              {a.created_by === me.id || canManage ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${a.file_name}`}
                  onClick={async () => {
                    try {
                      await deleteAttachment(sb, a);
                      setRows((r) => r.filter((x) => x.id !== a.id));
                    } catch (err) {
                      toastError(err);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">No files attached.</p>
      )}
    </section>
  );
}
