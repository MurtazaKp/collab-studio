import type { SupabaseClient } from "@supabase/supabase-js";
import { playlistItemInputSchema, shoppingItemInputSchema, type PlaylistItemInput, type ShoppingItemInput } from "@collabverse/shared";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type PlaylistItem = Tables<"playlist_items">;
export type ShoppingItem = Tables<"shopping_items">;

// ---------------------------------------------------------------- playlists

export async function loadPlaylistItems(sb: Client, playlistId: string): Promise<PlaylistItem[]> {
  const { data, error } = await sb.from("playlist_items").select("*").eq("playlist_id", playlistId);
  if (error) throw error;
  return data;
}

export async function addPlaylistItem(
  sb: Client,
  ids: { workspaceId: string; playlistId: string },
  input: Partial<PlaylistItemInput>,
  position: string,
): Promise<PlaylistItem> {
  const v = playlistItemInputSchema.parse(input);
  const { data, error } = await sb
    .from("playlist_items")
    .insert({ workspace_id: ids.workspaceId, playlist_id: ids.playlistId, title: v.title, url: v.url, artist: v.artist, note: v.note, position })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updatePlaylistItem(sb: Client, id: string, patch: Partial<PlaylistItemInput> & { position?: string }): Promise<void> {
  // zod 4's .partial() still applies .default() values, so copy only the
  // fields the caller actually passed (a reorder must not blank artist/note).
  const v = playlistItemInputSchema.partial().parse(patch);
  const update: Database["public"]["Tables"]["playlist_items"]["Update"] = {};
  if (patch.title !== undefined) update.title = v.title;
  if (patch.url !== undefined) update.url = v.url;
  if (patch.artist !== undefined) update.artist = v.artist;
  if (patch.note !== undefined) update.note = v.note;
  if (patch.position) update.position = patch.position;
  const { data, error } = await sb.from("playlist_items").update(update).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this playlist.");
}

export async function removePlaylistItem(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("playlist_items").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this playlist.");
}

export async function updatePlaylistDescription(sb: Client, id: string, description: string): Promise<void> {
  const { data, error } = await sb.from("playlists").update({ description: description.slice(0, 500) }).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this playlist.");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ----------------------------------------------------------------- shopping

export async function loadShoppingItems(sb: Client, listId: string): Promise<ShoppingItem[]> {
  const { data, error } = await sb.from("shopping_items").select("*").eq("list_id", listId);
  if (error) throw error;
  return data;
}

export async function addShoppingItem(
  sb: Client,
  ids: { workspaceId: string; listId: string },
  input: Partial<ShoppingItemInput>,
  position: string,
): Promise<ShoppingItem> {
  const v = shoppingItemInputSchema.parse(input);
  const { data, error } = await sb
    .from("shopping_items")
    .insert({
      workspace_id: ids.workspaceId,
      list_id: ids.listId,
      name: v.name,
      quantity: v.quantity,
      unit: v.unit,
      category: v.category,
      assignee_id: v.assigneeId,
      position,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateShoppingItem(
  sb: Client,
  id: string,
  patch: Partial<ShoppingItemInput> & { checked?: boolean; position?: string },
): Promise<ShoppingItem> {
  const v = shoppingItemInputSchema.partial().parse(patch);
  const update: Database["public"]["Tables"]["shopping_items"]["Update"] = {};
  if (patch.name !== undefined) update.name = v.name;
  if (patch.quantity !== undefined) update.quantity = v.quantity;
  if (patch.unit !== undefined) update.unit = v.unit;
  if (patch.category !== undefined) update.category = v.category;
  if (patch.assigneeId !== undefined) update.assignee_id = v.assigneeId ?? null;
  if (patch.checked !== undefined) update.checked = patch.checked;
  if (patch.position !== undefined) update.position = patch.position;
  const { data, error } = await sb.from("shopping_items").update(update).eq("id", id).select("*");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this list.");
  return data[0]!;
}

export async function removeShoppingItems(sb: Client, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await sb.from("shopping_items").delete().in("id", ids).select("id");
  if (error) throw error;
  if (data.length < ids.length) throw new Error("Some items couldn't be removed. You may not have permission.");
}
