import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLANS } from "@/components/marketing/plans";

// The database is the authority on limits; the marketing copy and the UI read
// plans.ts. This keeps the two from drifting apart.
const read = (file: string) => readFileSync(fileURLToPath(new URL(`../../../../supabase/migrations/${file}`, import.meta.url)), "utf8");
const billing = read("20261023000009_platform_admin_billing.sql");
const accounts = read("20261023000010_account_plans.sql");

const num = (v: string) => (v === "null" ? null : Number(v));
const modules = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]);

function seededPlan(id: string) {
  // 0009 seeds Free/Team/Business; 0010 adds max_workspaces and seeds Custom.
  const old = billing.match(new RegExp(`\\('${id}', '([^']+)', (\\d+), (\\w+), (\\w+), (\\w+), (\\d+),\\s*array\\[([^\\]]+)\\]`));
  if (old) {
    const ws = accounts.match(new RegExp(`set max_workspaces = (\\d+) where id = '${id}'`));
    return {
      name: old[1],
      monthlyCents: Number(old[2]),
      annualCents: num(old[3]!),
      maxMembers: num(old[4]!),
      maxItemsPerModule: num(old[5]!),
      storageMb: num(old[6]!),
      maxWorkspaces: ws ? Number(ws[1]) : null,
      modules: modules(old[7]!),
    };
  }
  const added = accounts.match(
    new RegExp(`\\('${id}', '([^']+)', (\\d+), (\\w+), (\\w+), (\\w+), (\\w+), (\\w+),\\s*array\\[([^\\]]+)\\]`),
  );
  if (!added) throw new Error(`Plan ${id} not found in the migration seeds`);
  return {
    name: added[1],
    monthlyCents: Number(added[2]),
    annualCents: num(added[3]!),
    maxMembers: num(added[4]!),
    maxItemsPerModule: num(added[5]!),
    storageMb: num(added[6]!),
    maxWorkspaces: num(added[7]!),
    modules: modules(added[8]!),
  };
}

describe("plans.ts matches the database seed", () => {
  it.each(PLANS.map((p) => [p.id, p] as const))("%s", (id, plan) => {
    const db = seededPlan(id);
    expect(db.name).toBe(plan.name);
    // Custom is priced per customer: 0 in the seed, null in the UI.
    expect(db.monthlyCents).toBe((plan.monthly ?? 0) * 100);
    expect(db.annualCents).toBe(plan.annual === null ? null : plan.annual * 100);
    expect(db.maxMembers).toBe(plan.limits.maxMembers);
    expect(db.maxItemsPerModule).toBe(plan.limits.maxItemsPerModule);
    expect(db.storageMb).toBe(plan.limits.storageMb);
    expect(db.maxWorkspaces).toBe(plan.limits.maxWorkspaces);
    expect(db.modules).toEqual([...plan.limits.modules]);
  });
});
