/**
 * Fill a demo workspace for an existing account (development only).
 *
 *   DATABASE_URL=postgresql://... npm run db:seed-demo -- you@example.com
 *
 * Installs dev.seed_demo_workspace() from supabase/seed.sql if needed, looks
 * up the user by email and calls it. No credentials are created or stored.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const email = process.argv[2];
const url = process.env.DATABASE_URL;
if (!email || !url) {
  console.error("Usage: DATABASE_URL=... npm run db:seed-demo -- <email of an existing account>");
  process.exit(1);
}
if (!/localhost|127\.0\.0\.1/.test(url) && process.env.ALLOW_REMOTE_SEED !== "1") {
  console.error("Refusing to seed a non-local database. Set ALLOW_REMOTE_SEED=1 if this is a staging project.");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(readFileSync(join(root, "supabase", "seed.sql"), "utf8"));
  const user = await client.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [email]);
  if (!user.rows[0]) throw new Error(`No account for ${email}; sign up in the app first.`);
  await client.query("begin");
  const r = await client.query<{ ws: string }>("select dev.seed_demo_workspace($1) as ws", [user.rows[0].id]);
  await client.query("commit");
  console.log(`Demo workspace created: /w/${r.rows[0]!.ws}`);
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
