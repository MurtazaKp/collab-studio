import { defineConfig, devices } from "@playwright/test";

/**
 * Two layers of browser tests:
 *   e2e/smoke.spec.ts  — runs anywhere, no external services.
 *   e2e/multiuser/*    — real multi-user tests in separate browser contexts;
 *                        require a Supabase project + collaboration server
 *                        (see docs/TESTING.md). Skipped when not configured.
 *
 * Set E2E_BASE_URL to test an already-running deployment; otherwise the
 * built web app is started on port 3100.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start --workspace @collabverse/web -- -p 3100",
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
