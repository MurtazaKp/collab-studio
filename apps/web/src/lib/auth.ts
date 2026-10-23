import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { isModuleType, type ModuleType, type Role } from "@collabverse/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Profile = Tables<"profiles">;
export type Workspace = Tables<"workspaces">;
export type WorkspaceModule = Tables<"workspace_modules">;

/** The verified current user (checked with Supabase Auth), cached per request. */
export const getCurrentUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser(next?: string) {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data;
});

export interface MembershipSummary {
  workspace: Pick<Workspace, "id" | "name" | "icon" | "color">;
  role: Role;
}

export const getMyWorkspaces = cache(async (): Promise<MembershipSummary[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces!inner(id, name, icon, color)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });
  return (data ?? []).map((row) => ({ workspace: row.workspace, role: row.role }));
});

export interface WorkspaceAccess {
  userId: string;
  workspace: Workspace;
  role: Role;
  modules: WorkspaceModule[];
}

/**
 * Loads a workspace the current user belongs to, with their role, using their
 * own RLS-scoped session. Non-members get a 404 (no existence leak).
 */
export const getWorkspaceAccess = cache(async (workspaceId: string): Promise<WorkspaceAccess> => {
  const user = await requireUser(`/w/${workspaceId}`);
  if (!/^[0-9a-f-]{36}$/.test(workspaceId)) notFound();
  const supabase = await createServerSupabase();
  const [{ data: workspace }, { data: membership }, { data: modules }] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(),
    supabase.from("workspace_modules").select("*").eq("workspace_id", workspaceId).order("position"),
  ]);
  if (!workspace || !membership) notFound();
  return { userId: user.id, workspace, role: membership.role, modules: modules ?? [] };
});

/** 404 unless the module exists and is enabled in this workspace. */
export async function requireModule(workspaceId: string, type: ModuleType): Promise<WorkspaceAccess> {
  const access = await getWorkspaceAccess(workspaceId);
  const mod = access.modules.find((m) => m.module_type === type);
  if (!mod || !mod.enabled || !isModuleType(mod.module_type)) notFound();
  return access;
}
