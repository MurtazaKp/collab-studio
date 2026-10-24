import type { Metadata } from "next";
import { canManage, isModuleType, isRole } from "@collabverse/shared";
import { getMyWorkspaces, getProfile, getWorkspaceAccess } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { getWorkspaceBilling, getWorkspaceWriteState } from "@/lib/billing-server";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import type { WorkspaceMember, WorkspaceModuleInfo } from "@/lib/workspace-context";

export async function generateMetadata({ params }: { params: Promise<{ workspaceId: string }> }): Promise<Metadata> {
  const { workspaceId } = await params;
  const { workspace } = await getWorkspaceAccess(workspaceId);
  return { title: { default: workspace.name, template: `%s · ${workspace.name}` } };
}

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const access = await getWorkspaceAccess(workspaceId);
  const supabase = await createServerSupabase();
  // The plan (price, limits, usage) is for owners and admins; every member only
  // learns whether the workspace can be changed.
  const [profile, workspaces, { data: memberRows }, billing, writeState] = await Promise.all([
    getProfile(),
    getMyWorkspaces(),
    supabase.rpc("workspace_member_list", { p_workspace_id: workspaceId }),
    canManage(access.role) ? getWorkspaceBilling(workspaceId) : Promise.resolve(null),
    getWorkspaceWriteState(workspaceId),
  ]);

  const members: WorkspaceMember[] = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    name: m.display_name || "Unnamed",
    color: m.avatar_color,
    role: isRole(m.role) ? m.role : "viewer",
    email: m.email,
  }));
  const modules: WorkspaceModuleInfo[] = access.modules
    .filter((m) => isModuleType(m.module_type))
    .map((m) => ({
      type: m.module_type,
      enabled: m.enabled,
      config: (m.config && typeof m.config === "object" && !Array.isArray(m.config) ? m.config : {}) as WorkspaceModuleInfo["config"],
    }));

  return (
    <WorkspaceShell
      workspace={{
        id: access.workspace.id,
        name: access.workspace.name,
        description: access.workspace.description,
        icon: access.workspace.icon,
        color: access.workspace.color,
        ownerId: access.workspace.owner_id,
      }}
      role={access.role}
      me={{ id: access.userId, name: profile?.display_name || "You", color: profile?.avatar_color ?? "iris" }}
      members={members}
      modules={modules}
      billing={billing}
      writeState={writeState}
      workspaces={workspaces.map((w) => ({ ...w.workspace, role: w.role }))}
    >
      {children}
    </WorkspaceShell>
  );
}
