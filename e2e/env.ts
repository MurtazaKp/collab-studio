import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Configuration for the multi-user suite (never used by the app itself). */
export const e2e = {
  supabaseUrl: process.env.E2E_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "",
};

export const multiUserEnabled = Boolean(e2e.supabaseUrl && e2e.serviceRoleKey);
export const SKIP_REASON =
  "Multi-user E2E needs E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY (a disposable test project), plus the app and collaboration server running against it. See docs/TESTING.md.";

export interface TestAccount {
  email: string;
  password: string;
  name: string;
}

export const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), ".auth", "accounts.json");

export function accounts(): { a: TestAccount; b: TestAccount; c: TestAccount } {
  if (!existsSync(STATE_FILE)) throw new Error("Run via Playwright so global setup creates test accounts");
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
