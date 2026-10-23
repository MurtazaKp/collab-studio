import type { Metadata } from "next";
import { canManage } from "@collabverse/shared";
import { getWorkspaceAccess } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { MembersSettings, SettingsFrame } from "@/components/workspace/settings";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const access = await getWorkspaceAccess(workspaceId);
  let invitations: { id: string; email: string; role: string; expires_at: string; created_at: string }[] = [];
  if (canManage(access.role)) {
    const { data } = await (await createServerSupabase())
      .from("invitations")
      .select("id, email, role, expires_at, created_at")
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    invitations = data ?? [];
  }
  return (
    <SettingsFrame>
      <MembersSettings invitations={invitations} />
    </SettingsFrame>
  );
}
