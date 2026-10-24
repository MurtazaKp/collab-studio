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

const planSchema = z.object({ userId: uuidSchema, planId: z.enum(["free", "team", "business", "custom"]) });
const statusSchema = z.object({
  userId: uuidSchema,
  status: z.enum(["active", "past_due", "canceled", "suspended"]),
  reason: z.string().trim().max(500).default(""),
});
const trialSchema = z.object({ userId: uuidSchema, days: z.number().int().min(1).max(90) });
const notesSchema = z.object({ userId: uuidSchema, notes: z.string().max(2000) });
/** Dollars a month in the form, stored as cents; null clears the price. */
const priceSchema = z.object({ userId: uuidSchema, dollars: z.number().min(0).max(1_000_000).nullable() });

async function client() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return supabase;
}

/** The customer's plan applies to every workspace they own, so refresh the app too. */
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/w", "layout");
}

export async function adminSetPlanAction(input: { userId: string; planId: string }): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid plan.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_plan", { p_user_id: parsed.data.userId, p_plan_id: parsed.data.planId });
  if (error) return fail(error, "Couldn't change the plan.");
  refresh();
  return ok();
}

export async function adminSetStatusAction(input: { userId: string; status: string; reason?: string }): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid status.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_status", {
    p_user_id: parsed.data.userId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "Couldn't change the status.");
  refresh();
  return ok();
}

export async function adminExtendTrialAction(input: { userId: string; days: number }): Promise<ActionResult> {
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return fail("Trials can be extended by 1 to 90 days.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_extend_trial", { p_user_id: parsed.data.userId, p_days: parsed.data.days });
  if (error) return fail(error, "Couldn't extend the trial.");
  refresh();
  return ok();
}

export async function adminSetNotesAction(input: { userId: string; notes: string }): Promise<ActionResult> {
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return fail("Notes can be at most 2000 characters.");
  const supabase = await client();
  const { error } = await supabase.rpc("admin_set_notes", { p_user_id: parsed.data.userId, p_notes: parsed.data.notes });
  if (error) return fail(error, "Couldn't save the notes.");
  revalidatePath(`/admin/customers/${parsed.data.userId}`);
  return ok();
}

export async function adminSetCustomPriceAction(input: { userId: string; dollars: number | null }): Promise<ActionResult> {
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a monthly price between $0 and $1,000,000.");
  const supabase = await client();
  const cents = parsed.data.dollars === null ? null : Math.round(parsed.data.dollars * 100);
  // The generated type can't express a nullable argument; NULL clears the price.
  const { error } = await supabase.rpc("admin_set_custom_price", { p_user_id: parsed.data.userId, p_cents: cents as number });
  if (error) return fail(error, "Couldn't save the price.");
  refresh();
  return ok();
}

const transferSchema = z.object({
  workspaceId: uuidSchema,
  email: z.string().trim().toLowerCase().email().max(254),
  reason: z.string().trim().max(500).default(""),
});

/** Moves a workspace to the account with this email (they join as owner). */
export async function adminTransferWorkspaceAction(input: { workspaceId: string; email: string; reason?: string }): Promise<ActionResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the new owner's email address.");
  const supabase = await client();
  const { data, error: findError } = await supabase.rpc("admin_list_customers", { p_search: parsed.data.email, p_limit: 20, p_offset: 0 });
  if (findError) return fail(findError, "Couldn't look up that account.");
  const match = (data ?? []).find((c) => c.email.toLowerCase() === parsed.data.email);
  if (!match) return fail("No account uses that email. They need to sign up first.");
  const { error } = await supabase.rpc("admin_transfer_workspace", {
    p_workspace_id: parsed.data.workspaceId,
    p_new_owner: match.user_id,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error, "Couldn't transfer the workspace.");
  refresh();
  return ok();
}
