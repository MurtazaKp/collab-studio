"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  MODULE_TYPES,
  WORKSPACE_COLORS,
  inviteInputSchema,
  moduleToggleSchema,
  roleChangeSchema,
  uuidSchema,
  workspaceInputSchema,
} from "@collabverse/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { errorMessage } from "@/lib/utils";
import type { Json } from "@/lib/supabase/database.types";
import { DASHBOARD_SIZES } from "@/lib/dashboard";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (error: unknown, fallback?: string): ActionResult<never> => ({ ok: false, error: errorMessage(error, fallback) });

async function client() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return { supabase, user: data.user };
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function createWorkspaceAction(input: {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  modules: string[];
}): Promise<ActionResult<{ id: string }>> {
  const parsed = workspaceInputSchema.safeParse(input);
  const modules = z.array(z.enum(MODULE_TYPES)).min(1, "Pick at least one module").safeParse(input.modules);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  if (!modules.success) return fail(modules.error.issues[0]?.message);
  const { supabase } = await client();
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_description: parsed.data.description,
    p_icon: parsed.data.icon,
    p_color: parsed.data.color,
    p_modules: modules.data,
  });
  if (error || !data) return fail(error, "Couldn't create the workspace.");
  revalidatePath("/w", "layout");
  return ok({ id: data });
}

export async function updateWorkspaceAction(
  workspaceId: string,
  input: { name: string; description: string; icon: string; color: string },
): Promise<ActionResult> {
  const id = uuidSchema.safeParse(workspaceId);
  const parsed = workspaceInputSchema.safeParse(input);
  if (!id.success || !parsed.success) return fail(parsed.error?.issues[0]?.message ?? "Invalid input");
  const { supabase } = await client();
  const { data, error } = await supabase
    .from("workspaces")
    .update({ name: parsed.data.name, description: parsed.data.description, icon: parsed.data.icon, color: parsed.data.color })
    .eq("id", id.data)
    .select("id");
  if (error) return fail(error);
  if (!data?.length) return fail("Only owners and admins can change workspace settings.");
  revalidatePath(`/w/${id.data}`, "layout");
  return ok(null);
}

export async function deleteWorkspaceAction(workspaceId: string, confirmName: string): Promise<ActionResult> {
  const id = uuidSchema.safeParse(workspaceId);
  if (!id.success) return fail("Invalid workspace");
  const { supabase } = await client();
  const { data: ws } = await supabase.from("workspaces").select("name").eq("id", id.data).maybeSingle();
  if (!ws || ws.name !== confirmName) return fail("Type the workspace name exactly to confirm.");
  const { error } = await supabase.rpc("delete_workspace", { p_workspace_id: id.data });
  if (error) return fail(error);
  revalidatePath("/w", "layout");
  redirect("/w");
}

export async function setLastWorkspaceAction(workspaceId: string): Promise<void> {
  const id = uuidSchema.safeParse(workspaceId);
  if (!id.success) return;
  const { supabase, user } = await client();
  await supabase.from("profiles").update({ last_workspace_id: id.data }).eq("id", user.id);
}

// ---------------------------------------------------------------------------
// Modules and dashboard
// ---------------------------------------------------------------------------

export async function setModuleEnabledAction(input: { workspaceId: string; moduleType: string; enabled: boolean }): Promise<ActionResult> {
  const parsed = moduleToggleSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid module");
  const { supabase } = await client();
  const { data, error } = await supabase
    .from("workspace_modules")
    .update({ enabled: parsed.data.enabled })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("module_type", parsed.data.moduleType)
    .select("id");
  if (error) return fail(error);
  if (!data?.length) return fail("Only owners and admins can configure modules.");
  revalidatePath(`/w/${parsed.data.workspaceId}`, "layout");
  return ok(null);
}

const moduleConfigSchema = z.object({ pinnedId: uuidSchema.nullable().optional() }).strict();

export async function setModuleConfigAction(input: { workspaceId: string; moduleType: string; config: unknown }): Promise<ActionResult> {
  const ws = uuidSchema.safeParse(input.workspaceId);
  const type = z.enum(MODULE_TYPES).safeParse(input.moduleType);
  const config = moduleConfigSchema.safeParse(input.config);
  if (!ws.success || !type.success || !config.success) return fail("Invalid module configuration");
  const { supabase } = await client();
  const { data, error } = await supabase
    .from("workspace_modules")
    .update({ config: config.data as Json })
    .eq("workspace_id", ws.data)
    .eq("module_type", type.data)
    .select("id");
  if (error) return fail(error);
  if (!data?.length) return fail("Only owners and admins can configure modules.");
  revalidatePath(`/w/${ws.data}`);
  return ok(null);
}

const layoutSchema = z
  .array(z.object({ module: z.enum(MODULE_TYPES), size: z.enum(DASHBOARD_SIZES) }).strict())
  .max(16)
  .refine((items) => new Set(items.map((i) => i.module)).size === items.length, "Duplicate modules");

export async function saveDashboardLayoutAction(workspaceId: string, items: unknown): Promise<ActionResult> {
  const ws = uuidSchema.safeParse(workspaceId);
  const parsed = layoutSchema.safeParse(items);
  if (!ws.success || !parsed.success) return fail("Invalid layout");
  const { supabase, user } = await client();
  const { error } = await supabase
    .from("dashboard_layouts")
    .upsert({ workspace_id: ws.data, user_id: user.id, items: parsed.data as Json }, { onConflict: "workspace_id,user_id" });
  if (error) return fail(error);
  revalidatePath(`/w/${ws.data}`);
  return ok(null);
}

// ---------------------------------------------------------------------------
// Members and invitations
// ---------------------------------------------------------------------------

export async function inviteMemberAction(input: { workspaceId: string; email: string; role: string }): Promise<ActionResult<{ link: string; expiresAt: string }>> {
  const parsed = inviteInputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { supabase } = await client();
  const { data, error } = await supabase.rpc("create_invitation", {
    p_workspace_id: parsed.data.workspaceId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  const row = data?.[0];
  if (error || !row) return fail(error, "Couldn't create the invitation.");
  revalidatePath(`/w/${parsed.data.workspaceId}/settings/members`);
  return ok({ link: `${publicEnv.siteUrl.replace(/\/$/, "")}/invite/${row.token}`, expiresAt: row.expires_at });
}

export async function revokeInvitationAction(workspaceId: string, invitationId: string): Promise<ActionResult> {
  const id = uuidSchema.safeParse(invitationId);
  if (!id.success) return fail("Invalid invitation");
  const { supabase } = await client();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: id.data });
  if (error) return fail(error);
  revalidatePath(`/w/${workspaceId}/settings/members`);
  return ok(null);
}

export async function changeRoleAction(input: { workspaceId: string; userId: string; role: string }): Promise<ActionResult> {
  const parsed = roleChangeSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid role");
  const { supabase } = await client();
  const { error } = await supabase.rpc("update_member_role", {
    p_workspace_id: parsed.data.workspaceId,
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  });
  if (error) return fail(error);
  revalidatePath(`/w/${parsed.data.workspaceId}/settings/members`);
  return ok(null);
}

export async function removeMemberAction(workspaceId: string, userId: string): Promise<ActionResult> {
  const ws = uuidSchema.safeParse(workspaceId);
  const uid = uuidSchema.safeParse(userId);
  if (!ws.success || !uid.success) return fail("Invalid member");
  const { supabase, user } = await client();
  const { error } = await supabase.rpc("remove_member", { p_workspace_id: ws.data, p_user_id: uid.data });
  if (error) return fail(error);
  if (uid.data === user.id) {
    revalidatePath("/w", "layout");
    redirect("/w");
  }
  revalidatePath(`/w/${ws.data}/settings/members`);
  return ok(null);
}

export async function transferOwnershipAction(workspaceId: string, userId: string): Promise<ActionResult> {
  const ws = uuidSchema.safeParse(workspaceId);
  const uid = uuidSchema.safeParse(userId);
  if (!ws.success || !uid.success) return fail("Invalid member");
  const { supabase } = await client();
  const { error } = await supabase.rpc("transfer_ownership", { p_workspace_id: ws.data, p_new_owner: uid.data });
  if (error) return fail(error);
  revalidatePath(`/w/${ws.data}`, "layout");
  return ok(null);
}

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

export async function acceptInvitationAction(token: string): Promise<ActionResult<{ workspaceId: string }>> {
  const t = tokenSchema.safeParse(token);
  if (!t.success) return fail("This invitation link is not valid.");
  const { supabase } = await client();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: t.data });
  if (error || !data) return fail(error, "Couldn't accept the invitation.");
  revalidatePath("/w", "layout");
  return ok({ workspaceId: data });
}

export async function acceptInvitationByIdAction(invitationId: string): Promise<ActionResult<{ workspaceId: string }>> {
  const id = uuidSchema.safeParse(invitationId);
  if (!id.success) return fail("Invalid invitation");
  const { supabase } = await client();
  const { data, error } = await supabase.rpc("accept_invitation_by_id", { p_invitation_id: id.data });
  if (error || !data) return fail(error, "Couldn't accept the invitation.");
  revalidatePath("/w", "layout");
  return ok({ workspaceId: data });
}

export async function declineInvitationAction(invitationId: string): Promise<ActionResult> {
  const id = uuidSchema.safeParse(invitationId);
  if (!id.success) return fail("Invalid invitation");
  const { supabase } = await client();
  const { error } = await supabase.rpc("decline_invitation", { p_invitation_id: id.data });
  if (error) return fail(error);
  revalidatePath("/invitations");
  return ok(null);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  avatarColor: z.enum(WORKSPACE_COLORS),
});

export async function updateProfileAction(input: { displayName: string; avatarColor: string }): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message);
  const { supabase, user } = await client();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName, avatar_color: parsed.data.avatarColor })
    .eq("id", user.id);
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return ok(null);
}

export async function completeOnboardingAction(displayName: string): Promise<ActionResult> {
  const name = z.string().trim().min(1).max(60).safeParse(displayName);
  if (!name.success) return fail("Enter your name");
  const { supabase, user } = await client();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name.data, onboarded_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return fail(error);
  return ok(null);
}

