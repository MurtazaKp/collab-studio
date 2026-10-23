import "server-only";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { ItemRow, ItemTable } from "./items";

/** Load an item visible to the current user (RLS) within the workspace, or 404. */
export async function getItemOr404(table: ItemTable, id: string, workspaceId: string): Promise<ItemRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createServerSupabase();
  const { data } = await supabase.from(table).select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  if (!data) notFound();
  return data as ItemRow;
}
