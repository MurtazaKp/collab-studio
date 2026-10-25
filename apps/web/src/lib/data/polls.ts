import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type Poll = Tables<"polls">;
export type PollOption = Tables<"poll_options">;
export type PollVote = Tables<"poll_votes">;

const labelSchema = z.string().trim().min(1, "Write an option.").max(200, "Options can be at most 200 characters.");
const descriptionSchema = z.string().max(1000, "The description can be at most 1000 characters.");

/** Whether people can still vote (the database enforces the same rule). */
export function pollIsOpen(poll: Pick<Poll, "closed_at" | "closes_at">, now = Date.now()): boolean {
  return poll.closed_at === null && (poll.closes_at === null || new Date(poll.closes_at).getTime() > now);
}

export async function loadPollOptions(sb: Client, pollId: string): Promise<PollOption[]> {
  const { data, error } = await sb.from("poll_options").select("*").eq("poll_id", pollId);
  if (error) throw error;
  return data;
}

/** Votes the caller may see: everyone's, or only their own in anonymous polls. */
export async function loadPollVotes(sb: Client, pollId: string): Promise<PollVote[]> {
  const { data, error } = await sb.from("poll_votes").select("*").eq("poll_id", pollId);
  if (error) throw error;
  return data;
}

export async function addPollOption(sb: Client, ids: { workspaceId: string; pollId: string }, label: string, position: string): Promise<PollOption> {
  const { data, error } = await sb
    .from("poll_options")
    .insert({ workspace_id: ids.workspaceId, poll_id: ids.pollId, label: labelSchema.parse(label), position })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function renamePollOption(sb: Client, id: string, label: string): Promise<void> {
  const { data, error } = await sb.from("poll_options").update({ label: labelSchema.parse(label) }).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this poll.");
}

export async function removePollOption(sb: Client, id: string): Promise<void> {
  const { data, error } = await sb.from("poll_options").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this poll.");
}

export async function castVote(sb: Client, v: { workspaceId: string; pollId: string; optionId: string; userId: string }): Promise<void> {
  const { error } = await sb.from("poll_votes").insert({ workspace_id: v.workspaceId, poll_id: v.pollId, option_id: v.optionId, user_id: v.userId });
  if (error) throw error;
}

export async function withdrawVote(sb: Client, voteId: string): Promise<void> {
  const { data, error } = await sb.from("poll_votes").delete().eq("id", voteId).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("That vote couldn't be withdrawn.");
}

export interface PollSettings {
  description?: string;
  multiple?: boolean;
  anonymous?: boolean;
  closes_at?: string | null;
  closed_at?: string | null;
}

export async function updatePoll(sb: Client, id: string, patch: PollSettings): Promise<void> {
  const update: Database["public"]["Tables"]["polls"]["Update"] = {};
  if (patch.description !== undefined) update.description = descriptionSchema.parse(patch.description);
  if (patch.multiple !== undefined) update.multiple = patch.multiple;
  if (patch.anonymous !== undefined) update.anonymous = patch.anonymous;
  if (patch.closes_at !== undefined) update.closes_at = patch.closes_at;
  if (patch.closed_at !== undefined) update.closed_at = patch.closed_at;
  const { data, error } = await sb.from("polls").update(update).eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this poll.");
}
