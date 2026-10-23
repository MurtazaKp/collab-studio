import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { e2e, type TestAccount } from "../env";

export interface Session {
  context: BrowserContext;
  page: Page;
}

/** A separate browser context (own cookies/storage) signed in as `account`. */
export async function signIn(browser: Browser, account: TestAccount): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(w|onboarding)/);
  return { context, page };
}

/**
 * Moves a workspace to a paid plan and switches every module on, through the
 * test project's REST API with the service role (test setup only; the web app
 * never holds that key). New workspaces start on Free, which lacks several of
 * the tools these tests exercise.
 */
export async function upgradeWorkspace(workspaceId: string, planId = "team"): Promise<void> {
  const headers = {
    apikey: e2e.serviceRoleKey,
    Authorization: `Bearer ${e2e.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  const patchRows = async (table: string, body: object) => {
    const res = await fetch(`${e2e.supabaseUrl}/rest/v1/${table}?workspace_id=eq.${workspaceId}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Couldn't update ${table} (${res.status}): ${await res.text()}`);
  };
  await patchRows("workspace_subscriptions", { plan_id: planId, status: "active" });
  await patchRows("workspace_modules", { enabled: true });
}

/** Workspace id from the current URL. */
export function workspaceIdOf(page: Page): string {
  const m = page.url().match(/\/w\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`Not on a workspace page: ${page.url()}`);
  return m[1]!;
}

export async function createItem(page: Page, workspaceId: string, segment: string, noun: string, title: string): Promise<string> {
  await page.goto(`/w/${workspaceId}/${segment}`);
  await page.getByRole("button", { name: new RegExp(`New ${noun}`, "i") }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(new RegExp(`/${segment}/[0-9a-f-]{36}`));
  return page.url();
}

export async function waitSynced(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /Saved|View only/ }).first()).toBeVisible({ timeout: 20_000 });
}
