import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { PAGE_SIZE, listChannels, loadMessages } from "@/lib/data/chat";
import { ChatView } from "@/components/modules/chat/chat-view";

type Params = Promise<{ workspaceId: string; channelId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspaceId, channelId } = await params;
  const channels = await listChannels(await createServerSupabase(), workspaceId);
  const c = channels.find((x) => x.id === channelId);
  return { title: c ? `#${c.name}` : "Chat" };
}

export default async function ChannelPage({ params }: { params: Params }) {
  const { workspaceId, channelId } = await params;
  await requireModule(workspaceId, "chat");
  if (!/^[0-9a-f-]{36}$/.test(channelId)) notFound();
  const sb = await createServerSupabase();
  const channels = await listChannels(sb, workspaceId);
  const channel = channels.find((c) => c.id === channelId);
  if (!channel) notFound();
  const messages = await loadMessages(sb, channelId);
  return (
    <Suspense>
      <ChatView channel={channel} initialChannels={channels} initialMessages={messages} initialHasMore={messages.length >= PAGE_SIZE} />
    </Suspense>
  );
}
