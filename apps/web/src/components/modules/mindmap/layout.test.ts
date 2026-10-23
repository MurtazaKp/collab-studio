import { describe, expect, it } from "vitest";
import type { MindmapNodeData } from "@collabverse/shared/mindmap";
import { childPosition, tidyLayout } from "./layout";

const node = (id: string, parentId: string | null, y = 0): MindmapNodeData => ({ id, parentId, label: id, x: 0, y, color: "iris" });

describe("mindmap layout", () => {
  it("places children one level right and centres parents", () => {
    const pos = tidyLayout([node("root", null), node("a", "root", 0), node("b", "root", 10), node("a1", "a", 0)]);
    expect(pos.root!.x).toBe(0);
    expect(pos.a!.x).toBe(240);
    expect(pos.a1!.x).toBe(480);
    expect(pos.root!.y).toBe(0);
    expect(pos.b!.y).toBeGreaterThan(pos.a!.y);
  });

  it("puts new children below existing siblings", () => {
    const nodes = [node("root", null), { ...node("a", "root"), x: 240, y: 30 }];
    expect(childPosition(nodes, "root")).toEqual({ x: 240, y: 94 });
    expect(childPosition(nodes, "a")).toEqual({ x: 480, y: 30 });
  });
});
