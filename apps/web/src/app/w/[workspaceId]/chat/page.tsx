import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireModule } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { listChannels } from "@/lib/data/chat";
import { ChatEmpty } from "@/components/modules/chat/chat-view";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatIndex({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireModule(workspaceId, "chat");
  const channels = await listChannels(await createServerSupabase(), workspaceId);
  const target = channels.find((c) => c.name === "general") ?? channels[0];
  if (target) redirect(`/w/${workspaceId}/chat/${target.id}`);
  return <ChatEmpty />;
}
