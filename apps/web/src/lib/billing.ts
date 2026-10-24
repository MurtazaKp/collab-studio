import { z } from "zod";
import { MODULE_TYPES, isModuleType, type ModuleType } from "@collabverse/shared";

/**
 * Plan and usage of one workspace, as returned by the `workspace_usage` RPC.
 * A workspace runs on its owner's account plan, so the plan fields describe
 * the owner's subscription.
 * Shared by server components (which load it) and client components (which
 * display it). The database enforces every limit shown here.
 */

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "suspended"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  suspended: "Suspended",
};

export const STATUS_TONES: Record<SubscriptionStatus, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  trialing: "accent",
  active: "success",
  past_due: "warning",
  canceled: "neutral",
  suspended: "danger",
};

const usageCounts = z
  .record(z.string(), z.coerce.number())
  .transform((rec) => Object.fromEntries(MODULE_TYPES.map((m) => [m, rec[m] ?? 0])) as Record<ModuleType, number>);

export const workspaceUsageSchema = z
  .object({
    plan_id: z.string(),
    plan_name: z.string(),
    subscribed_plan_id: z.string(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    trial_ends_at: z.string().nullable(),
    trial_expired: z.boolean(),
    current_period_end: z.string().nullable(),
    writable: z.boolean(),
    monthly_price_cents: z.coerce.number(),
    max_members: z.coerce.number().nullable(),
    member_count: z.coerce.number(),
    max_items_per_module: z.coerce.number().nullable(),
    storage_mb: z.coerce.number().nullable(),
    storage_bytes: z.coerce.number(),
    modules: z.array(z.string()),
    usage: usageCounts,
    max_workspaces: z.coerce.number().nullable(),
    owner_workspace_count: z.coerce.number(),
    owner_name: z.string(),
    is_owner: z.boolean(),
  })
  .transform((r) => ({
    planId: r.plan_id,
    planName: r.plan_name,
    subscribedPlanId: r.subscribed_plan_id,
    status: r.status,
    trialEndsAt: r.trial_ends_at,
    trialExpired: r.trial_expired,
    currentPeriodEnd: r.current_period_end,
    writable: r.writable,
    monthlyPriceCents: r.monthly_price_cents,
    maxMembers: r.max_members,
    memberCount: r.member_count,
    maxItemsPerModule: r.max_items_per_module,
    storageMb: r.storage_mb,
    storageBytes: r.storage_bytes,
    modules: r.modules.filter(isModuleType),
    usage: r.usage,
    maxWorkspaces: r.max_workspaces,
    ownerWorkspaceCount: r.owner_workspace_count,
    ownerName: r.owner_name,
    isOwner: r.is_owner,
  }));

export type WorkspaceBilling = z.output<typeof workspaceUsageSchema>;

/** What every member may know: can the workspace be changed, and if not, why. */
export interface WorkspaceWriteState {
  writable: boolean;
  status: SubscriptionStatus;
}

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * MB) return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
}

export function formatStorageMb(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

export function formatPrice(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 0-100, or null when the limit is unlimited. */
export function usagePercent(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function meterTone(percent: number | null): "accent" | "warning" | "danger" {
  if (percent === null || percent < 80) return "accent";
  return percent < 100 ? "warning" : "danger";
}

/** Whether a trial end date has passed (display only; the database decides). */
export function trialOver(trialEndsAt: string | null, now = Date.now()): boolean {
  return trialEndsAt !== null && new Date(trialEndsAt).getTime() <= now;
}

/** Whole days until `iso` (negative once it has passed). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/** One-line plan state, e.g. "Team trial · 5 days left" or "Suspended". */
export function statusSummary(b: Pick<WorkspaceBilling, "status" | "trialEndsAt" | "trialExpired">, now = Date.now()): string {
  if (b.status === "trialing" && b.trialEndsAt) {
    if (b.trialExpired) return "Trial ended";
    const days = daysUntil(b.trialEndsAt, now);
    return `Trial · ${days} day${days === 1 ? "" : "s"} left`;
  }
  return STATUS_LABELS[b.status];
}
