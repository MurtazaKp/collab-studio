import { getStroke } from "perfect-freehand";
import type { WbObject } from "@collabverse/shared/whiteboard";

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function toCanvas(screen: Point, vp: Viewport): Point {
  return { x: (screen.x - vp.x) / vp.zoom, y: (screen.y - vp.y) / vp.zoom };
}

/** Zoom by `factor` keeping the screen point `anchor` fixed. */
export function zoomAt(vp: Viewport, anchor: Point, factor: number): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  const k = zoom / vp.zoom;
  return { zoom, x: anchor.x - (anchor.x - vp.x) * k, y: anchor.y - (anchor.y - vp.y) * k };
}

export function bounds(objects: Pick<WbObject, "x" | "y" | "w" | "h">[]): { x: number; y: number; w: number; h: number } | null {
  if (!objects.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const o of objects) {
    minX = Math.min(minX, o.x);
    minY = Math.min(minY, o.y);
    maxX = Math.max(maxX, o.x + o.w);
    maxY = Math.max(maxY, o.y + o.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function fitViewport(objects: WbObject[], width: number, height: number, padding = 80): Viewport {
  const b = bounds(objects.filter((o) => o.type !== "connector"));
  if (!b) return { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = clampZoom(Math.min((width - padding * 2) / Math.max(b.w, 1), (height - padding * 2) / Math.max(b.h, 1), 1.5));
  return { zoom, x: width / 2 - (b.x + b.w / 2) * zoom, y: height / 2 - (b.y + b.h / 2) * zoom };
}

export function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normRect(a: Point, b: Point) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Where the ray from the centre of `o` towards `target` leaves its bounding box (ellipses approximated). */
export function edgePoint(o: Pick<WbObject, "x" | "y" | "w" | "h" | "type">, target: Point): Point {
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (o.type === "ellipse") {
    const a = o.w / 2;
    const b = o.h / 2;
    const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return { x: cx + dx * t, y: cy + dy * t };
  }
  const sx = dx !== 0 ? o.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? o.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** SVG path for a perfect-freehand stroke from flat [x0, y0, x1, y1, ...] points. */
export function strokePath(points: number[], size: number): string {
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) pairs.push([points[i]!, points[i + 1]!]);
  const outline = getStroke(pairs, { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
  if (!outline.length) return "";
  const d = outline.reduce<string[]>((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length]!;
    acc.push(`${x0!.toFixed(1)},${y0!.toFixed(1)} ${((x0! + x1!) / 2).toFixed(1)},${((y0! + y1!) / 2).toFixed(1)}`);
    return acc;
  }, []);
  return `M ${d[0]} Q ${d.slice(1).join(" ")} Z`;
}
