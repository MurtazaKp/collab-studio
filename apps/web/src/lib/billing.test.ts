import { describe, expect, it } from "vitest";
import { daysUntil, formatBytes, formatPrice, formatStorageMb, meterTone, statusSummary, usagePercent, workspaceUsageSchema } from "./billing";

const row = {
  plan_id: "free",
  plan_name: "Free",
  subscribed_plan_id: "free",
  status: "active",
  trial_ends_at: null,
  trial_expired: false,
  current_period_end: null,
  writable: true,
  monthly_price_cents: 0,
  max_members: 3,
  member_count: 2,
  max_items_per_module: 25,
  storage_mb: 100,
  storage_bytes: "1048576",
  modules: ["docs", "kanban", "chat", "shopping", "bogus"],
  usage: { docs: 4, chat: 1 },
};

describe("workspaceUsageSchema", () => {
  it("normalises the RPC row: numbers, known modules only, every module counted", () => {
    const b = workspaceUsageSchema.parse(row);
    expect(b).toMatchObject({ planId: "free", memberCount: 2, maxMembers: 3, storageBytes: 1048576, writable: true });
    expect(b.modules).toEqual(["docs", "kanban", "chat", "shopping"]);
    expect(b.usage).toEqual({ docs: 4, whiteboard: 0, kanban: 0, chat: 1, mindmap: 0, code: 0, playlist: 0, shopping: 0 });
  });

  it("keeps unlimited limits as null and rejects unknown statuses", () => {
    expect(workspaceUsageSchema.parse({ ...row, max_members: null, max_items_per_module: null })).toMatchObject({ maxMembers: null, maxItemsPerModule: null });
    expect(workspaceUsageSchema.safeParse({ ...row, status: "frozen" }).success).toBe(false);
  });
});

describe("formatting", () => {
  it("formats sizes and prices", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(formatStorageMb(100)).toBe("100 MB");
    expect(formatStorageMb(10240)).toBe("10 GB");
    expect(formatPrice(2900)).toBe("$29");
    expect(formatPrice(123456)).toBe("$1,234.56");
  });

  it("computes meters, capped at 100% and null for unlimited", () => {
    expect(usagePercent(1, 4)).toBe(25);
    expect(usagePercent(9, 3)).toBe(100);
    expect(usagePercent(5, null)).toBeNull();
    expect(meterTone(50)).toBe("accent");
    expect(meterTone(85)).toBe("warning");
    expect(meterTone(100)).toBe("danger");
    expect(meterTone(null)).toBe("accent");
  });

  it("summarises the subscription status", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(daysUntil("2026-10-28T12:00:00Z", now)).toBe(5);
    expect(statusSummary({ status: "trialing", trialEndsAt: "2026-10-24T11:00:00Z", trialExpired: false }, now)).toBe("Trial · 1 day left");
    expect(statusSummary({ status: "trialing", trialEndsAt: "2026-10-20T00:00:00Z", trialExpired: true }, now)).toBe("Trial ended");
    expect(statusSummary({ status: "past_due", trialEndsAt: null, trialExpired: false }, now)).toBe("Past due");
  });
});
