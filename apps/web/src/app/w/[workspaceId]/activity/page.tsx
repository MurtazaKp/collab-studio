import type { Metadata } from "next";
import { getWorkspaceAccess } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { workspace } = await getWorkspaceAccess(workspaceId);
  const { data } = await (await createServerSupabase())
    .from("activity_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader crumbs={[{ label: workspace.name, href: `/w/${workspaceId}` }, { label: "Activity" }]} title="Activity" meta="The latest 100 events in this workspace, updated live." />
      <div className="mx-6 rounded-2xl border border-border bg-surface px-5 py-2 shadow-sm lg:mx-10">
        <ActivityFeed initial={data ?? []} limit={100} />
      </div>
    </div>
  );
}
