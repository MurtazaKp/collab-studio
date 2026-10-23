/**
 * Recognises the errors the database raises when a workspace hits its plan
 * (see supabase/migrations/20261023000009_platform_admin_billing.sql and
 * 20261023000010_account_plans.sql). The
 * database is authoritative; this only decides how the error is presented.
 *
 * Supabase errors carry the Postgres HINT (`plan_*`) and SQLSTATE (PT402 /
 * PT403). Server actions pass on just the message, so the wording is matched
 * as a fallback.
 */
export type PlanErrorKind = "workspace_limit" | "member_limit" | "item_limit" | "module" | "storage" | "inactive";

const HINTS: Record<string, PlanErrorKind> = {
  plan_workspace_limit: "workspace_limit",
  plan_member_limit: "member_limit",
  plan_item_limit: "item_limit",
  plan_module: "module",
  plan_storage: "storage",
  plan_inactive: "inactive",
};

const PATTERNS: [RegExp, PlanErrorKind][] = [
  [/plan allows up to \d+ workspaces?\b/i, "workspace_limit"],
  [/plan allows up to \d+ people/i, "member_limit"],
  [/plan allows up to \d+ /i, "item_limit"],
  [/isn't included in the .+ plan/i, "module"],
  [/of file storage/i, "storage"],
  [/(suspended|canceled), so it's read-only/i, "inactive"],
  [/account is (suspended|canceled)/i, "inactive"],
];

export const PLAN_ERROR_TITLES: Record<PlanErrorKind, string> = {
  workspace_limit: "Workspace limit reached",
  member_limit: "Your plan is full",
  item_limit: "Plan limit reached",
  module: "Not on your plan",
  storage: "Storage is full",
  inactive: "Workspace is read-only",
};

function field(err: unknown, key: "hint" | "code" | "message"): string {
  if (typeof err === "string") return key === "message" ? err : "";
  if (err && typeof err === "object" && key in err) {
    const value = (err as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }
  return "";
}

export function planErrorKind(err: unknown): PlanErrorKind | null {
  const hint = HINTS[field(err, "hint")];
  if (hint) return hint;
  const message = field(err, "message");
  for (const [re, kind] of PATTERNS) if (re.test(message)) return kind;
  const code = field(err, "code");
  if (code === "PT403") return "inactive";
  if (code === "PT402") return "item_limit";
  return null;
}

/** Suspended workspaces need support, not a bigger plan. */
export function planErrorOffersUpgrade(kind: PlanErrorKind, message: string): boolean {
  return kind !== "inactive" || /canceled/i.test(message);
}
