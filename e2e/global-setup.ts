import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { STATE_FILE, e2e, multiUserEnabled, type TestAccount } from "./env";

/**
 * Creates three fresh, email-confirmed accounts in the *test* Supabase project
 * via the Auth admin API. Passwords are random per run and only written to
 * e2e/.auth (gitignored).
 */
export default async function globalSetup() {
  if (!multiUserEnabled) return;
  const run = randomBytes(4).toString("hex");
  const make = async (label: string): Promise<TestAccount> => {
    const account = { email: `e2e-${label}-${run}@example.test`, password: randomBytes(18).toString("base64url"), name: `E2E ${label.toUpperCase()}` };
    const res = await fetch(`${e2e.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: e2e.serviceRoleKey, Authorization: `Bearer ${e2e.serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password, email_confirm: true, user_metadata: { display_name: account.name } }),
    });
    if (!res.ok) throw new Error(`Couldn't create test user (${res.status}): ${await res.text()}`);
    return account;
  };
  const accounts = { a: await make("a"), b: await make("b"), c: await make("c") };
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(accounts, null, 2));
}
