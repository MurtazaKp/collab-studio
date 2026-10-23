import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentInputSchema,
  columnTitleSchema,
  commentBodySchema,
  safeStorageName,
  taskInputSchema,
  type TaskInput,
} from "@collabverse/shared";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type Column = Tables<"board_columns">;
export type Task = Tables<"tasks">;
export type Comment = Tables<"comments">;
export type Attachment = Tables<"attachments">;

/** Thrown when an optimistic-concurrency check fails. */
export class ConflictError extends Error {
  constructor() {
    super("Someone else changed this card. Showing the latest version.");
    this.name = "ConflictError";
  }
}

export async function loadColumns(sb: Client, boardId: string): Promise<Column[]> {
  const { data, error } = await sb.from("board_columns").select("*").eq("board_id", boardId);
  if (error) throw error;
  return data;
}

export async function loadTasks(sb: Client, boardId: string): Promise<Task[]> {
  const { data, error } = await sb.from("tasks").select("*").eq("board_id", boardId);
  if (error) throw error;
  return data;
}

export async function addColumn(sb: Client, workspaceId: string, boardId: string, title: string, position: string): Promise<Column> {
  const { data, error } = await sb
    .from("board_columns")
    .insert({ workspace_id: workspaceId, board_id: boardId, title: columnTitleSchema.parse(title), position })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateColumn(sb: Client, id: string, patch: { title?: string; position?: string }): Promise<void> {
  const update: { title?: string; position?: string } = {};
  if (patch.title !== undefined) update.title = columnTitleSchema.parse(patch.title);
  if (patch.position !== undefined) update.position = patch.position;
  const { data, error } = await sb.from("board_columns").update(update).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this column.");
}

export async function deleteColumn(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("board_columns").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to delete this column.");
}

export async function createTask(
  sb: Client,
  input: { workspaceId: string; boardId: string; columnId: string; title: string; position: string },
): Promise<Task> {
  const { title } = taskInputSchema.pick({ title: true }).parse({ title: input.title });
  const { data, error } = await sb
    .from("tasks")
    .insert({ workspace_id: input.workspaceId, board_id: input.boardId, column_id: input.columnId, title, position: input.position })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function moveTask(sb: Client, task: Task, columnId: string, position: string): Promise<Task> {
  const { data, error } = await sb.rpc("move_task", {
    p_task_id: task.id,
    p_column_id: columnId,
    p_position: position,
    p_expected_version: task.version,
  });
  if (error) {
    if (error.code === "40001") throw new ConflictError();
    throw error;
  }
  return data as unknown as Task;
}

/** Update task fields only if nobody changed the card since `task.version`. */
export async function updateTask(sb: Client, task: Task, patch: Partial<TaskInput>): Promise<Task> {
  const parsed = taskInputSchema.partial().parse(patch);
  const update: Database["public"]["Tables"]["tasks"]["Update"] = {};
  if (patch.title !== undefined) update.title = parsed.title;
  if (patch.description !== undefined) update.description = parsed.description;
  if (patch.priority !== undefined) update.priority = parsed.priority;
  if (patch.dueDate !== undefined) update.due_date = parsed.dueDate ?? null;
  if (patch.assigneeId !== undefined) update.assignee_id = parsed.assigneeId ?? null;
  if (patch.labels !== undefined) update.labels = parsed.labels;
  const { data, error } = await sb.from("tasks").update(update).eq("id", task.id).eq("version", task.version).select("*");
  if (error) throw error;
  if (!data.length) throw new ConflictError();
  return data[0]!;
}

export async function deleteTask(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("tasks").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to delete this card.");
}

export async function loadComments(sb: Client, taskId: string): Promise<Comment[]> {
  const { data, error } = await sb.from("comments").select("*").eq("task_id", taskId).order("created_at");
  if (error) throw error;
  return data;
}

export async function addComment(sb: Client, workspaceId: string, taskId: string, body: string): Promise<Comment> {
  const { data, error } = await sb
    .from("comments")
    .insert({ workspace_id: workspaceId, task_id: taskId, body: commentBodySchema.parse(body) })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("comments").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You can only delete your own comments.");
}

export async function loadAttachments(sb: Client, taskId: string): Promise<Attachment[]> {
  const { data, error } = await sb.from("attachments").select("*").eq("task_id", taskId).order("created_at");
  if (error) throw error;
  return data;
}

export async function uploadAttachment(sb: Client, workspaceId: string, taskId: string, file: File): Promise<Attachment> {
  const meta = attachmentInputSchema.safeParse({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
  if (!meta.success) {
    if (file.size > ATTACHMENT_MAX_BYTES) throw new Error("Files can be up to 10 MB.");
    throw new Error("That file type isn't supported. Use images, PDF, text, CSV, Markdown or ZIP.");
  }
  const path = `${workspaceId}/${crypto.randomUUID()}/${safeStorageName(file.name)}`;
  const { error: upErr } = await sb.storage.from("attachments").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { data, error } = await sb
    .from("attachments")
    .insert({
      workspace_id: workspaceId,
      task_id: taskId,
      storage_path: path,
      file_name: meta.data.fileName,
      mime_type: meta.data.mimeType,
      size_bytes: meta.data.sizeBytes,
    })
    .select("*")
    .single();
  if (error) {
    await sb.storage.from("attachments").remove([path]);
    throw error;
  }
  return data;
}

export async function attachmentUrl(sb: Client, a: Attachment): Promise<string> {
  const { data, error } = await sb.storage.from("attachments").createSignedUrl(a.storage_path, 60, { download: a.file_name });
  if (error || !data) throw error ?? new Error("Couldn't create a download link.");
  return data.signedUrl;
}

export async function deleteAttachment(sb: Client, a: Attachment): Promise<void> {
  const { data, error } = await sb.from("attachments").delete().eq("id", a.id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You can only remove files you uploaded.");
  await sb.storage.from("attachments").remove([a.storage_path]);
}
