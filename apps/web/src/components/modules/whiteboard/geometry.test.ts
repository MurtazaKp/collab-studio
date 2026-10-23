import { describe, expect, it } from "vitest";
import { edgePoint, fitViewport, normRect, rectsIntersect, toCanvas, zoomAt, strokePath } from "./geometry";

describe("whiteboard geometry", () => {
  it("converts between screen and canvas and zooms around the cursor", () => {
    const vp = { x: 100, y: 50, zoom: 2 };
    expect(toCanvas({ x: 300, y: 250 }, vp)).toEqual({ x: 100, y: 100 });
    const zoomed = zoomAt(vp, { x: 300, y: 250 }, 1.5);
    // The canvas point under the cursor stays put.
    expect(toCanvas({ x: 300, y: 250 }, zoomed)).toEqual({ x: 100, y: 100 });
    expect(zoomAt(vp, { x: 0, y: 0 }, 1000).zoom).toBe(4);
  });

  it("finds connector anchor points on shape edges", () => {
    const rect = { type: "rect" as const, x: 0, y: 0, w: 100, h: 50 };
    expect(edgePoint(rect, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
    const ellipse = { type: "ellipse" as const, x: 0, y: 0, w: 100, h: 100 };
    const p = edgePoint(ellipse, { x: 50, y: 500 });
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(100);
  });

  it("handles rectangles and fitting", () => {
    expect(normRect({ x: 10, y: 10 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 1, h: 1 })).toBe(false);
    const vp = fitViewport([], 800, 600);
    expect(vp).toEqual({ x: 400, y: 300, zoom: 1 });
  });

  it("builds a stroke path", () => {
    expect(strokePath([0, 0, 10, 10, 20, 5], 4)).toMatch(/^M .* Z$/);
    expect(strokePath([], 4)).toBe("");
  });
});
