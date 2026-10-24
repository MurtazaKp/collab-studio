import { MODULE_TYPES, type ModuleType } from "@collabverse/shared";

export type PlanId = "free" | "team" | "business" | "custom";

/**
 * What a plan allows. Mirrors the `plans` rows seeded in
 * supabase/migrations/20261023000009_platform_admin_billing.sql and
 * 20261023000010_account_plans.sql, which the database enforces;
 * lib/plans.test.ts keeps the two in step. `null` = unlimited.
 *
 * A plan belongs to the customer's account: every workspace they own runs on
 * it, and `maxWorkspaces` caps how many they may own.
 */
export interface PlanLimits {
  maxWorkspaces: number | null;
  maxMembers: number | null;
  maxItemsPerModule: number | null;
  storageMb: number | null;
  modules: readonly ModuleType[];
}

export const FREE_MODULES: readonly ModuleType[] = ["docs", "kanban", "chat", "shopping"];

export interface Plan {
  id: PlanId;
  name: string;
  /** USD per month; null for Custom, which is priced per customer. */
  monthly: number | null;
  annual: number | null;
  people: string;
  storage: string;
  blurb: string;
  features: string[];
  cta: string;
  featured?: boolean;
  limits: PlanLimits;
}

export const TRIAL_NOTE = "14-day Team trial. No card required.";

/**
 * Where "Contact us" on the Custom plan goes. Set NEXT_PUBLIC_SALES_URL (for
 * example a mailto: link or a booking page); until then it starts a sign-up.
 */
export const SALES_HREF = process.env.NEXT_PUBLIC_SALES_URL || "/signup";

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    annual: null,
    people: "Up to 3 people",
    storage: "100 MB file storage",
    blurb: "For trying CollabVerse with a couple of colleagues.",
    features: ["1 workspace", "Up to 3 people", "100 MB file storage", "Live cursors and presence", "Owner, Admin, Member and Viewer roles"],
    cta: "Start for free",
    limits: { maxWorkspaces: 1, maxMembers: 3, maxItemsPerModule: 25, storageMb: 100, modules: FREE_MODULES },
  },
  {
    id: "team",
    name: "Team",
    monthly: 35,
    annual: 350,
    people: "Up to 15 people",
    storage: "10 GB file storage",
    blurb: "For a small office that wants every tool in one place.",
    features: ["Up to 3 workspaces", "Up to 15 people in each", "All 8 tools", "10 GB file storage", "Live cursors and presence"],
    cta: "Start free trial",
    featured: true,
    limits: { maxWorkspaces: 3, maxMembers: 15, maxItemsPerModule: null, storageMb: 10240, modules: MODULE_TYPES },
  },
  {
    id: "business",
    name: "Business",
    monthly: 89,
    annual: 890,
    people: "Up to 50 people",
    storage: "50 GB file storage",
    blurb: "For growing teams that need oversight and faster help.",
    features: ["Up to 10 workspaces", "Up to 50 people in each", "All 8 tools", "50 GB file storage", "Audit log", "Priority support"],
    cta: "Start free trial",
    limits: { maxWorkspaces: 10, maxMembers: 50, maxItemsPerModule: null, storageMb: 51200, modules: MODULE_TYPES },
  },
  {
    id: "custom",
    name: "Custom",
    monthly: null,
    annual: null,
    people: "Unlimited people",
    storage: "Unlimited file storage",
    blurb: "For organisations with many teams, sites or clients.",
    features: ["Unlimited workspaces", "Unlimited people", "All 8 tools", "Unlimited file storage", "Audit log", "Priority support"],
    cta: "Contact us",
    limits: { maxWorkspaces: null, maxMembers: null, maxItemsPerModule: null, storageMb: null, modules: MODULE_TYPES },
  },
];

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** "3 workspaces", "1 workspace", "Unlimited workspaces". */
export function workspacesLabel(max: number | null): string {
  if (max === null) return "Unlimited workspaces";
  return `${max} workspace${max === 1 ? "" : "s"}`;
}
