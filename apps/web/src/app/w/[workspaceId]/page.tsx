import type { Metadata } from "next";
import { isModuleType, type ModuleType } from "@collabverse/shared";
import { getWorkspaceAccess } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { ITEM_TABLE, isItemModule, listItems, type ItemRow } from "@/lib/data/items";
import { Dashboard } from "@/components/dashboard/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await getWorkspaceAccess(workspaceId);
  const sb = await createServerSupabase();
  const enabled = access.modules.filter((m) => m.enabled && isModuleType(m.module_type)).map((m) => m.module_type as ModuleType);

  const [layout, activity, ...lists] = await Promise.all([
    sb.from("dashboard_layouts").select("items").eq("workspace_id", workspaceId).eq("user_id", access.userId).maybeSingle(),
    sb.from("activity_events").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(6),
    ...enabled.filter(isItemModule).map(async (m) => [m, await listItems(sb, ITEM_TABLE[m], workspaceId, 12)] as const),
  ]);
  const itemsByModule: Partial<Record<ModuleType, ItemRow[]>> = Object.fromEntries(lists);

  return <Dashboard savedLayout={layout.data?.items ?? null} itemsByModule={itemsByModule} activity={activity.data ?? []} />;
}
