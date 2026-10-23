import { describe, expect, it } from "vitest";
import { safeNextPath } from "./env";

describe("safeNextPath", () => {
  it("keeps same-origin paths, including query strings", () => {
    expect(safeNextPath("/w")).toBe("/w");
    expect(safeNextPath("/w/abc/kanban/def?task=1")).toBe("/w/abc/kanban/def?task=1");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "javascript:alert(1)", "", null, undefined]) {
      expect(safeNextPath(bad as string | null | undefined, "/fallback")).toBe("/fallback");
    }
  });
});
