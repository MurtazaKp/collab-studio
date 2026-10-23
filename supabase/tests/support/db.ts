import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "..", "migrations");
export const SEED_FILE = join(here, "..", "..", "seed.sql");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function shimSql(): string {
  return readFileSync(join(here, "supabase-shim.sql"), "utf8");
}

/** Fresh in-memory Postgres with the Supabase shim and every migration applied. */
export async function createTestDb(options: { seed?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(shimSql());
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  if (options.seed) {
    await db.exec(readFileSync(SEED_FILE, "utf8"));
  }
  return db;
}

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(
  db: PGlite,
  name: string,
  opts: { confirmed?: boolean; email?: string } = {},
): Promise<TestUser> {
  const id = randomUUID();
  const email = opts.email ?? `${name.toLowerCase()}-${id.slice(0, 8)}@example.test`;
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, $3, jsonb_build_object('display_name', $4::text))`,
    [id, email, opts.confirmed === false ? null : new Date().toISOString(), name],
  );
  return { id, email };
}

/**
 * Run `fn` exactly as PostgREST would for a signed-in user: role
 * `authenticated` with JWT claims set for the transaction. Everything is
 * rolled back if `fn` throws.
 */
export async function asUser<T>(
  db: PGlite,
  user: TestUser | null,
  fn: (tx: Transaction) => Promise<T>,
  extra: { topic?: string } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    if (user) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user.id, role: "authenticated", email: user.email }),
      ]);
      await tx.exec("set local role authenticated");
    } else {
      await tx.exec("set local role anon");
    }
    if (extra.topic) {
      await tx.query(`select set_config('realtime.topic', $1, true)`, [extra.topic]);
    }
    return fn(tx);
  });
}

/** Run as the least-privilege collaboration server role. */
export async function asCollabServer<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role collab_server");
    return fn(tx);
  });
}

/** Expect an operation to fail; returns the error message. */
export async function expectError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("Expected the operation to fail, but it succeeded");
}

export async function createWorkspace(db: PGlite, owner: TestUser, name = "Acme"): Promise<string> {
  return asUser(db, owner, async (tx) => {
    const r = await tx.query<{ id: string }>(`select public.create_workspace($1) as id`, [name]);
    return r.rows[0]!.id;
  });
}

/** Add a member directly (as superuser), bypassing invitations, for test setup. */
export async function addMember(db: PGlite, workspaceId: string, user: TestUser, role: string) {
  await db.query(`insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, $3)`, [
    workspaceId,
    user.id,
    role,
  ]);
}

/**
 * Put an account on a plan directly (as superuser). Every workspace the
 * account owns runs on that plan.
 */
export async function setAccountPlan(db: PGlite, user: TestUser | string, planId: string, status = "active") {
  await db.query(
    `update public.account_subscriptions
        set plan_id = $2, status = $3, trial_ends_at = case when $3 = 'trialing' then now() + interval '14 days' end
      where user_id = $1`,
    [typeof user === "string" ? user : user.id, planId, status],
  );
}

/**
 * Put a workspace's owner on a plan directly (as superuser), for tests that
 * exercise modules outside the Free plan. Also switches every module of the
 * workspace on, since modules the plan lacked were turned off at creation.
 */
export async function setPlan(db: PGlite, workspaceId: string, planId: string, status = "active") {
  const owner = await db.query<{ owner_id: string }>(`select owner_id from public.workspaces where id = $1`, [workspaceId]);
  await setAccountPlan(db, owner.rows[0]!.owner_id, planId, status);
  await db.query(`update public.workspace_modules set enabled = true where workspace_id = $1`, [workspaceId]);
}

export async function count(tx: Transaction | PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const r = await tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) s`, params);
  return r.rows[0]!.n;
}
