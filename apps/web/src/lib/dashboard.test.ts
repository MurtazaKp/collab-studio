import { describe, expect, it } from "vitest";
import { resolveLayout } from "./dashboard";

describe("resolveLayout", () => {
  it("keeps saved order, drops disabled/unknown/duplicate modules and appends new ones", () => {
    const saved = [
      { module: "chat", size: "lg" },
      { module: "nope", size: "sm" },
      { module: "code", size: "sm" },
      { module: "chat", size: "sm" },
      { module: "docs", size: "huge" },
    ];
    expect(resolveLayout(saved, ["docs", "chat", "kanban"])).toEqual([
      { module: "chat", size: "lg" },
      { module: "docs", size: "md" },
      { module: "kanban", size: "lg" },
    ]);
  });

  it("falls back to defaults for garbage input", () => {
    expect(resolveLayout("x", ["shopping"])).toEqual([{ module: "shopping", size: "sm" }]);
    expect(resolveLayout(null, [])).toEqual([]);
  });
});
