import { titleSchema, type ModuleType, type RoomKind } from "@collabverse/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";

/**
 * Typed data access for the "titled item" tables that back seven modules.
 * Every call runs with the caller's session, so RLS decides what is allowed;
 * inputs are validated here first for clear errors.
 */
export type ItemTable = "documents" | "whiteboards" | "mindmaps" | "code_projects" | "boards" | "playlists" | "shopping_lists";

export type ItemModule = Exclude<ModuleType, "chat">;

export const ITEM_TABLE: Record<ItemModule, ItemTable> = {
  docs: "documents",
  whiteboard: "whiteboards",
  mindmap: "mindmaps",
  code: "code_projects",
  kanban: "boards",
  playlist: "playlists",
  shopping: "shopping_lists",
};

export const ROOM_KIND: Partial<Record<ItemModule, RoomKind>> = {
  docs: "document",
  whiteboard: "whiteboard",
  mindmap: "mindmap",
  code: "code",
};

/** Columns common to every item table. */
export interface ItemRow {
  id: string;
  workspace_id: string;
  title: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  preview_text?: string;
  content_updated_at?: string | null;
  last_edited_by?: string | null;
  description?: string;
}

type Client = SupabaseClient<Database>;

export function isItemModule(m: ModuleType): m is ItemModule {
  return m !== "chat";
}

export async function listItems(sb: Client, table: ItemTable, workspaceId: string, limit = 200): Promise<ItemRow[]> {
  const { data, error } = await sb.from(table).select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as ItemRow[];
}

export async function createItem(sb: Client, module: ItemModule, workspaceId: string, rawTitle: string): Promise<ItemRow> {
  const title = titleSchema.parse(rawTitle);
  if (module === "kanban") {
    const { data: id, error } = await sb.rpc("create_board", { p_workspace_id: workspaceId, p_title: title });
    if (error || !id) throw error ?? new Error("Couldn't create board");
    const { data, error: e2 } = await sb.from("boards").select("*").eq("id", id).single();
    if (e2) throw e2;
    return data as ItemRow;
  }
  const table = ITEM_TABLE[module];
  const { data, error } = await sb.from(table).insert({ workspace_id: workspaceId, title }).select("*").single();
  if (error) throw error;
  return data as ItemRow;
}

export async function renameItem(sb: Client, table: ItemTable, id: string, rawTitle: string): Promise<void> {
  const title = titleSchema.parse(rawTitle);
  const { data, error } = await sb.from(table).update({ title }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("You don't have permission to rename this.");
}

export async function deleteItem(sb: Client, table: ItemTable, id: string): Promise<void> {
  const { data, error } = await sb.from(table).delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("You don't have permission to delete this.");
}

export type Document = Tables<"documents">;
