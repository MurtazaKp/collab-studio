import type { SupabaseClient } from "@supabase/supabase-js";
import { REACTION_EMOJI, channelNameSchema, messageBodySchema } from "@collabverse/shared";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type Channel = Tables<"channels">;
export type Message = Tables<"messages">;
export type Reaction = Tables<"message_reactions">;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

export const PAGE_SIZE = 40;

export async function listChannels(sb: Client, workspaceId: string): Promise<Channel[]> {
  const { data, error } = await sb.from("channels").select("*").eq("workspace_id", workspaceId).order("name");
  if (error) throw error;
  return data;
}

export async function createChannel(sb: Client, workspaceId: string, name: string, topic = ""): Promise<Channel> {
  const { data, error } = await sb
    .from("channels")
    .insert({ workspace_id: workspaceId, name: channelNameSchema.parse(name), topic: topic.trim().slice(0, 250) })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateChannel(sb: Client, id: string, patch: { name?: string; topic?: string }): Promise<void> {
  const update: { name?: string; topic?: string } = {};
  if (patch.name !== undefined) update.name = channelNameSchema.parse(patch.name);
  if (patch.topic !== undefined) update.topic = patch.topic.trim().slice(0, 250);
  const { data, error } = await sb.from("channels").update(update).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("Only the channel creator or an admin can change this channel.");
}

export async function deleteChannel(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("channels").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("Only the channel creator or an admin can delete this channel.");
}

/** Newest top-level messages, optionally older than a cursor (keyset pagination). */
export async function loadMessages(sb: Client, channelId: string, before?: { created_at: string; id: string }): Promise<Message[]> {
  let q = sb
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (before) q = q.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
  const { data, error } = await q;
  if (error) throw error;
  return data.reverse();
}

/** Everything (top-level and replies) newer than `since`, for catch-up after reconnects. */
export async function loadMessagesSince(sb: Client, channelId: string, since: string): Promise<Message[]> {
  const { data, error } = await sb
    .from("messages")
    .select("*")
    .eq("channel_id", channelId)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return data;
}

export async function loadThread(sb: Client, parentId: string): Promise<Message[]> {
  const { data, error } = await sb.from("messages").select("*").eq("parent_id", parentId).order("created_at").limit(500);
  if (error) throw error;
  return data;
}

export async function sendMessage(
  sb: Client,
  input: { id: string; workspaceId: string; channelId: string; body: string; parentId?: string | null },
): Promise<Message> {
  const { data, error } = await sb
    .from("messages")
    .insert({
      id: input.id,
      workspace_id: input.workspaceId,
      channel_id: input.channelId,
      body: messageBodySchema.parse(input.body),
      parent_id: input.parentId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function editMessage(sb: Client, id: string, body: string): Promise<Message> {
  const { data, error } = await sb.from("messages").update({ body: messageBodySchema.parse(body) }).eq("id", id).select("*");
  if (error) throw error;
  if (!data.length) throw new Error("You can only edit your own messages.");
  return data[0]!;
}

/** Authors soft-delete (keeps thread structure); managers may hard-delete. */
export async function removeMessage(sb: Client, msg: Message, asAuthor: boolean): Promise<void> {
  if (asAuthor) {
    const { data, error } = await sb.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", msg.id).select("id");
    if (error) throw error;
    if (data.length) return;
  }
  const { data, error } = await sb.from("messages").delete().eq("id", msg.id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You can't delete this message.");
}

export async function loadReactions(sb: Client, messageIds: string[]): Promise<Reaction[]> {
  if (!messageIds.length) return [];
  const { data, error } = await sb.from("message_reactions").select("*").in("message_id", messageIds);
  if (error) throw error;
  return data;
}

export async function toggleReaction(sb: Client, workspaceId: string, messageId: string, emoji: ReactionEmoji, mine: boolean, userId: string) {
  if (mine) {
    const { data, error } = await sb
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji)
      .select("message_id");
    if (error) throw error;
    if (!data.length) throw new Error("Couldn't remove the reaction.");
  } else {
    const { error } = await sb.from("message_reactions").insert({ message_id: messageId, workspace_id: workspaceId, emoji, user_id: userId });
    if (error && error.code !== "23505") throw error;
  }
}

export async function unreadCounts(sb: Client, workspaceId: string): Promise<Record<string, number>> {
  const { data, error } = await sb.rpc("channel_unread_counts", { p_workspace_id: workspaceId });
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.channel_id, Number(r.unread)]));
}

export async function markRead(sb: Client, channelId: string): Promise<void> {
  const { error } = await sb.rpc("mark_channel_read", { p_channel_id: channelId });
  if (error) throw error;
}

/** Split text into plain and http(s) link segments; nothing else becomes a link. */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
