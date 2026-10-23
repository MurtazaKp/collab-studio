import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/components/marketing/plans";

// The database is the authority on limits; the marketing copy and the UI read
// plans.ts. This keeps the two from drifting apart.
const migration = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20261023000009_platform_admin_billing.sql", import.meta.url)),
  "utf8",
);

function seededPlan(id: string) {
  const re = new RegExp(`\\('${id}', '([^']+)', (\\d+), (\\w+), (\\w+), (\\w+), (\\d+),\\s*array\\[([^\\]]+)\\]`);
  const m = migration.match(re);
  if (!m) throw new Error(`Plan ${id} not found in the migration seed`);
  const num = (v: string) => (v === "null" ? null : Number(v));
  return {
    name: m[1],
    monthlyCents: Number(m[2]),
    annualCents: num(m[3]!),
    maxMembers: num(m[4]!),
    maxItemsPerModule: num(m[5]!),
    storageMb: Number(m[6]),
    modules: [...m[7]!.matchAll(/'(\w+)'/g)].map((x) => x[1]),
  };
}

describe("plans.ts matches the database seed", () => {
  it.each(PLANS.map((p) => [p.id, p] as const))("%s", (id, plan) => {
    const db = seededPlan(id);
    expect(db.name).toBe(plan.name);
    expect(db.monthlyCents).toBe(plan.monthly * 100);
    expect(db.annualCents).toBe(plan.annual === null ? null : plan.annual * 100);
    expect(db.maxMembers).toBe(plan.limits.maxMembers);
    expect(db.maxItemsPerModule).toBe(plan.limits.maxItemsPerModule);
    expect(db.storageMb).toBe(plan.limits.storageMb);
    expect(db.modules).toEqual([...plan.limits.modules]);
  });
});
