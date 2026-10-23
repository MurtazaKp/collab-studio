"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidSchema } from "@collabverse/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils";
import type { ActionResult } from "@/app/actions/workspace";

/**
 * Platform admin mutations. Inputs are validated here for clear messages;
 * the admin_* RPCs re-check is_platform_admin() and write the audit log, so a
 * non-admin calling these actions gets "Platform admin access required".
 */

const ok = (): ActionResult => ({ ok: true, data: null });
const fail = (error: unknown, fallback?: string): ActionResult<never> => ({ ok: false, error: errorMessage(error, fallback) });

const planSchema = z.object({ workspaceId: uuidSchema, planId: z.enum(["free", "team", "business"]) });
const statusSchema = z.object({
  workspaceId: uuidSchema,
  status: z.enum(["active", "past_due", "canceled", "suspended"]),
  reason: z.string().trim().max(500).default(""),
});
const trialSchema = z.object({ workspaceId: uuidSchema, days: z.number().int().min(1).max(90) });
const notesSchema = z.object({ workspaceId: uuidSchema, notes: z.string().max(2000) });

async function client() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return supabase;
}

function refresh(workspaceId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/w/${workspaceId}`, "layout");
}

export async function adminSetPlanAction(input: { workspaceId: string; planId: string }): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid plan.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_plan", { p_workspace_id: parsed.data.workspaceId, p_plan_id: parsed.data.planId });
  if (error) return fail(error, "Couldn't change the plan.");
  refresh(parsed.data.workspaceId);
  return ok();
}

export async function adminSetStatusAction(input: { workspaceId: string; status: string; reason?: string }): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid status.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_status", {
    p_workspace_id: parsed.data.workspaceId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "Couldn't change the status.");
  refresh(parsed.data.workspaceId);
  return ok();
}

export async function adminExtendTrialAction(input: { workspaceId: string; days: number }): Promise<ActionResult> {
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return fail("Trials can be extended by 1 to 90 days.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_extend_trial", { p_workspace_id: parsed.data.workspaceId, p_days: parsed.data.days });
  if (error) return fail(error, "Couldn't extend the trial.");
  refresh(parsed.data.workspaceId);
  return ok();
}

export async function adminSetNotesAction(input: { workspaceId: string; notes: string }): Promise<ActionResult> {
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return fail("Notes can be at most 2000 characters.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_notes", { p_workspace_id: parsed.data.workspaceId, p_notes: parsed.data.notes });
  if (error) return fail(error, "Couldn't save the notes.");
  revalidatePath(`/admin/customers/${parsed.data.workspaceId}`);
  return ok();
}
