import type { Metadata } from "next";
import { requireModule } from "@/lib/auth";
import { getItemOr404 } from "@/lib/data/server-items";
import { createServerSupabase } from "@/lib/supabase/server";
import { loadPollOptions, loadPollVotes } from "@/lib/data/polls";
import { PollView } from "@/components/modules/polls/poll-view";

type Params = Promise<{ workspaceId: string; pollId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, pollId } = await params;
  return { title: (await getItemOr404("polls", pollId, workspaceId)).title };
}

export default async function PollPage({ params }: { params: Params }) {
  const { workspaceId, pollId } = await params;
  await requireModule(workspaceId, "polls");
  const poll = await getItemOr404("polls", pollId, workspaceId);
  const sb = await createServerSupabase();
  const [options, votes] = await Promise.all([loadPollOptions(sb, pollId), loadPollVotes(sb, pollId)]);
  return <PollView poll={poll} initialOptions={options} initialVotes={votes} />;
}
