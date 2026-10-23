import { describe, expect, it } from "vitest";
import { planErrorKind, planErrorOffersUpgrade } from "./plan-errors";

describe("planErrorKind", () => {
  it("reads the HINT the database attaches to Supabase errors", () => {
    expect(planErrorKind({ message: "anything", code: "PT402", hint: "plan_member_limit" })).toBe("member_limit");
    expect(planErrorKind({ message: "anything", code: "PT402", hint: "plan_storage" })).toBe("storage");
    expect(planErrorKind({ message: "anything", code: "PT403", hint: "plan_inactive" })).toBe("inactive");
  });

  it("falls back to the wording, for messages passed on by server actions", () => {
    expect(planErrorKind("This workspace's Free plan allows up to 3 people. Upgrade to add more.")).toBe("member_limit");
    expect(planErrorKind("This workspace's Free plan allows up to 25 documents. Upgrade to add more.")).toBe("item_limit");
    expect(planErrorKind("Whiteboard isn't included in the Free plan. Upgrade to use it.")).toBe("module");
    expect(planErrorKind("This workspace has used its 100 MB of file storage. Upgrade for more space.")).toBe("storage");
    expect(planErrorKind(new Error("This workspace is suspended, so it's read-only. Contact support to reactivate it."))).toBe("inactive");
  });

  it("falls back to the SQLSTATE, and ignores unrelated errors", () => {
    expect(planErrorKind({ code: "PT402", message: "" })).toBe("item_limit");
    expect(planErrorKind({ code: "PT403", message: "" })).toBe("inactive");
    expect(planErrorKind({ code: "42501", message: "new row violates row-level security policy" })).toBeNull();
    expect(planErrorKind("That already exists.")).toBeNull();
    expect(planErrorKind(null)).toBeNull();
    expect(planErrorKind(42)).toBeNull();
  });
});

describe("planErrorOffersUpgrade", () => {
  it("offers an upgrade for limits and canceled workspaces, but not suspensions", () => {
    expect(planErrorOffersUpgrade("member_limit", "")).toBe(true);
    expect(planErrorOffersUpgrade("inactive", "This workspace's subscription is canceled, so it's read-only.")).toBe(true);
    expect(planErrorOffersUpgrade("inactive", "This workspace is suspended, so it's read-only.")).toBe(false);
  });
});
