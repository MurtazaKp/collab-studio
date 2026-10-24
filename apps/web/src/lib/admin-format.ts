import { z } from "zod";
import { isModuleType } from "@collabverse/shared";
import { SUBSCRIPTION_STATUSES, STATUS_LABELS, formatPrice, type SubscriptionStatus } from "@/lib/billing";
import { planById } from "@/components/marketing/plans";

/**
 * Row shapes returned by the admin RPCs (supabase/migrations/20261023000010),
 * validated at the boundary because generated RPC types can't express which
 * output columns are nullable. Shared by server pages and client controls.
 */

const num = z.coerce.number();

export const customerRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string(),
  created_at: z.string(),
  plan_id: z.string(),
  plan_name: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  trial_ends_at: z.string().nullable(),
  custom_price_cents: num.nullable(),
  workspace_count: num,
  max_workspaces: num.nullable(),
  member_count: num,
  total_count: num,
});
export type CustomerRow = z.infer<typeof customerRowSchema>;

export const customerDetailSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string(),
  created_at: z.string(),
  plan_id: z.string(),
  effective_plan_id: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  trial_ends_at: z.string().nullable(),
  trial_expired: z.boolean(),
  current_period_end: z.string().nullable(),
  custom_price_cents: num.nullable(),
  monthly_price_cents: num,
  notes: z.string(),
  billing_customer_id: z.string().nullable(),
  billing_subscription_id: z.string().nullable(),
  subscription_updated_at: z.string().nullable(),
  max_workspaces: num.nullable(),
  max_members: num.nullable(),
  max_items_per_module: num.nullable(),
  storage_mb: num.nullable(),
  modules: z.array(z.string()).transform((m) => m.filter(isModuleType)),
  workspace_count: num,
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const customerWorkspaceSchema = z.object({
  workspace_id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  created_at: z.string(),
  member_count: num,
  pending_invitations: num,
  item_count: num,
  storage_bytes: num,
});
export type CustomerWorkspace = z.infer<typeof customerWorkspaceSchema>;

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
  "custom_price_set",
  "ownership_transferred",
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
  subject_user_id: z.string().nullable(),
  subject_email: z.string(),
  workspace_id: z.string().nullable(),
  workspace_name: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const overviewSchema = z.object({
  total_customers: num,
  total_workspaces: num,
  total_users: num,
  new_customers_30d: num,
  active_trials: num,
  mrr_cents: num,
  by_plan: z.array(
    z.object({ plan_id: z.string(), name: z.string(), monthly_price_cents: num, customers: num, paying: num, workspaces: num, mrr_cents: num }),
  ),
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

function price(cents: unknown): string {
  return typeof cents === "number" ? `${formatPrice(cents)}/mo` : "not set";
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
    case "ownership_transferred": {
      const reason = typeof d.reason === "string" && d.reason ? ` · “${d.reason}”` : "";
      return { title: "Workspace transferred", detail: `From ${String(d.from_email || "previous owner")}${reason}` };
    }
    case "custom_price_set":
      return { title: "Custom price set", detail: `${price(d.from)} → ${price(d.to)}` };
    case "admin_granted":
      return { title: "Platform admin granted", detail: String(d.email ?? "") };
    case "admin_revoked":
      return { title: "Platform admin revoked", detail: String(d.email ?? "") };
    case "billing_synced":
      return { title: "Billing provider update", detail: `${planName(d.plan_to)} · ${statusName(d.status_to)}` };
  }
}
