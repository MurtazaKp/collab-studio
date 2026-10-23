import { expect, test } from "@playwright/test";

/** Checks that run without any external services. */
test.describe("smoke", () => {
  test("health endpoint responds without caching", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.supabaseConfigured).toBe("boolean");
  });

  test("security headers are set", async ({ request }) => {
    const res = await request.get("/api/health");
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("protected pages never render for anonymous visitors", async ({ page, request }) => {
    const health = await (await request.get("/api/health")).json();
    await page.goto("/w");
    if (health.supabaseConfigured) {
      await expect(page).toHaveURL(/\/login\?next=%2Fw/);
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByRole("heading", { name: /Finish configuring/ })).toBeVisible();
    }
  });

  test("collab token endpoint rejects anonymous callers", async ({ request }) => {
    const res = await request.post("/api/collab/token", {
      data: { room: "document:3f1c2b8e-7a4d-4e5f-9a6b-1c2d3e4f5a6b" },
      maxRedirects: 0,
    });
    // 401 when Supabase is configured; a redirect to /setup when it isn't. Never a token.
    expect([401, 307]).toContain(res.status());
    expect(await res.text()).not.toContain("token\":");
  });
});
