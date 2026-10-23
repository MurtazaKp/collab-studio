import { MODULE_TYPES, type ModuleType } from "@collabverse/shared";

export type PlanId = "free" | "team" | "business";

/**
 * What a plan allows. Mirrors the `plans` rows seeded in
 * supabase/migrations/20261023000009_platform_admin_billing.sql, which the
 * database enforces; lib/plans.test.ts keeps the two in step. `null` = unlimited.
 */
export interface PlanLimits {
  maxMembers: number;
  maxItemsPerModule: number | null;
  storageMb: number;
  modules: readonly ModuleType[];
}

export const FREE_MODULES: readonly ModuleType[] = ["docs", "kanban", "chat", "shopping"];

export interface Plan {
  id: PlanId;
  name: string;
  monthly: number;
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

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    monthly: 0,
    annual: null,
    people: "Up to 3 people",
    storage: "100 MB file storage",
    blurb: "For trying CollabVerse with a couple of colleagues.",
    features: ["Up to 3 people", "100 MB file storage", "Live cursors and presence", "Owner, Admin, Member and Viewer roles"],
    cta: "Start for free",
    limits: { maxMembers: 3, maxItemsPerModule: 25, storageMb: 100, modules: FREE_MODULES },
  },
  {
    id: "team",
    name: "Team",
    monthly: 29,
    annual: 290,
    people: "Up to 15 people",
    storage: "10 GB file storage",
    blurb: "For a small office that wants every tool in one place.",
    features: ["Up to 15 people", "All 8 tools", "10 GB file storage", "Live cursors and presence", "Owner, Admin, Member and Viewer roles"],
    cta: "Start free trial",
    featured: true,
    limits: { maxMembers: 15, maxItemsPerModule: null, storageMb: 10240, modules: MODULE_TYPES },
  },
  {
    id: "business",
    name: "Business",
    monthly: 79,
    annual: 790,
    people: "Up to 50 people",
    storage: "50 GB file storage",
    blurb: "For growing teams that need oversight and faster help.",
    features: ["Up to 50 people", "All 8 tools", "50 GB file storage", "Audit log", "Priority support"],
    cta: "Start free trial",
    limits: { maxMembers: 50, maxItemsPerModule: null, storageMb: 51200, modules: MODULE_TYPES },
  },
];

export function planById(id: string | null | undefined): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
