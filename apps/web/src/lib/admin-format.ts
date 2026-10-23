import { z } from "zod";
import { MODULE_TYPES, isModuleType, type ModuleType } from "@collabverse/shared";
import { SUBSCRIPTION_STATUSES, STATUS_LABELS, type SubscriptionStatus } from "@/lib/billing";
import { planById } from "@/components/marketing/plans";

/**
 * Row shapes returned by the admin RPCs (supabase/migrations/20261023000009),
 * validated at the boundary because generated RPC types can't express which
 * output columns are nullable. Shared by server pages and client controls.
 */

const num = z.coerce.number();
const counts = z
  .record(z.string(), num)
  .transform((rec) => Object.fromEntries(MODULE_TYPES.map((m) => [m, rec[m] ?? 0])) as Record<ModuleType, number>);

export const customerRowSchema = z.object({
  workspace_id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  created_at: z.string(),
  owner_id: z.string(),
  owner_name: z.string(),
  owner_email: z.string(),
  plan_id: z.string(),
  plan_name: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  trial_ends_at: z.string().nullable(),
  current_period_end: z.string().nullable(),
  member_count: num,
  item_count: num,
  total_count: num,
});
export type CustomerRow = z.infer<typeof customerRowSchema>;

export const customerDetailSchema = z.object({
  workspace_id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  created_at: z.string(),
  owner_id: z.string(),
  owner_name: z.string(),
  owner_email: z.string(),
  plan_id: z.string(),
  effective_plan_id: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  trial_ends_at: z.string().nullable(),
  trial_expired: z.boolean(),
  current_period_end: z.string().nullable(),
  notes: z.string(),
  billing_customer_id: z.string().nullable(),
  billing_subscription_id: z.string().nullable(),
  subscription_updated_at: z.string().nullable(),
  max_members: num.nullable(),
  max_items_per_module: num.nullable(),
  storage_mb: num,
  modules: z.array(z.string()).transform((m) => m.filter(isModuleType)),
  member_count: num,
  pending_invitations: num,
  storage_bytes: num,
  usage: counts,
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const customerMemberSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string(),
  role: z.string(),
  joined_at: z.string(),
});
export type CustomerMember = z.infer<typeof customerMemberSchema>;

export const AUDIT_ACTIONS = [
  "plan_changed",
  "status_changed",
  "trial_extended",
  "notes_updated",
  "admin_granted",
  "admin_revoked",
  "billing_synced",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditEntrySchema = z.object({
  id: z.string(),
  created_at: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  actor_id: z.string().nullable(),
  actor_email: z.string(),
  workspace_id: z.string().nullable(),
  workspace_name: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const overviewSchema = z.object({
  total_workspaces: num,
  total_users: num,
  new_workspaces_30d: num,
  active_trials: num,
  mrr_cents: num,
  by_plan: z.array(z.object({ plan_id: z.string(), name: z.string(), monthly_price_cents: num, workspaces: num, paying: num })),
  by_status: z.record(z.string(), num).transform(
    (rec) => Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, rec[s] ?? 0])) as Record<SubscriptionStatus, number>,
  ),
});
export type Overview = z.infer<typeof overviewSchema>;

function planName(id: unknown): string {
  return typeof id === "string" ? (planById(id)?.name ?? id) : "?";
}

function statusName(s: unknown): string {
  return typeof s === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(s) ? STATUS_LABELS[s as SubscriptionStatus] : "?";
}

function day(iso: unknown): string {
  if (typeof iso !== "string") return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Human summary of one audit entry: a title and an optional detail line. */
export function describeAuditEntry(entry: Pick<AuditEntry, "action" | "details">): { title: string; detail: string } {
  const d = entry.details;
  switch (entry.action) {
    case "plan_changed":
      return { title: "Plan changed", detail: `${planName(d.from)} → ${planName(d.to)}` };
    case "status_changed": {
      const reason = typeof d.reason === "string" && d.reason ? ` · “${d.reason}”` : "";
      return { title: "Status changed", detail: `${statusName(d.from)} → ${statusName(d.to)}${reason}` };
    }
    case "trial_extended": {
      const plan = d.plan_from !== d.plan_to ? ` · ${planName(d.plan_from)} → ${planName(d.plan_to)}` : "";
      return { title: `Trial extended by ${String(d.days ?? "?")} days`, detail: `Now ends ${day(d.trial_ends_to)}${plan}` };
    }
    case "notes_updated":
      return { title: "Notes updated", detail: typeof d.after === "string" && d.after ? `“${d.after.slice(0, 120)}”` : "Notes cleared" };
    case "admin_granted":
      return { title: "Platform admin granted", detail: String(d.email ?? "") };
    case "admin_revoked":
      return { title: "Platform admin revoked", detail: String(d.email ?? "") };
    case "billing_synced":
      return { title: "Billing provider update", detail: `${planName(d.plan_to)} · ${statusName(d.status_to)}` };
  }
}
