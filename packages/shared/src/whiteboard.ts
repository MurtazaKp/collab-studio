import * as Y from "yjs";

/**
 * Shared whiteboard model (a documented shared-object model rather than a
 * third-party canvas binding).
 *
 * Y.Doc layout:  doc.getMap("objects")  id -> Y.Map of object fields
 *
 * Each object field is a separate Y.Map entry, so concurrent edits to different
 * fields of one object (move vs. recolour vs. text) merge; concurrent edits to
 * the same field resolve last-writer-wins, identically on every client.
 * Freehand points are written once at stroke end and never mutated.
 */

export const WB_OBJECT_TYPES = ["sticky", "text", "rect", "ellipse", "connector", "path"] as const;
export type WbObjectType = (typeof WB_OBJECT_TYPES)[number];

export const WB_COLORS = ["yellow", "pink", "blue", "green", "purple", "ink", "white"] as const;
export type WbColor = (typeof WB_COLORS)[number];

export interface WbObject {
  id: string;
  type: WbObjectType;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: WbColor;
  /** Stacking order; higher draws on top. */
  z: number;
  /** Connector endpoints (object ids). */
  from?: string;
  to?: string;
  /** Freehand stroke points relative to (x, y). */
  points?: number[];
  strokeWidth?: number;
  /** Text size in px; absent means the type's default (see defaultFontSize). */
  fontSize?: number;
}

export const WB_FONT_MIN = 10;
export const WB_FONT_MAX = 120;

export function defaultFontSize(type: WbObjectType): number {
  return type === "text" ? 20 : 15;
}

const LIMIT = 1_000_000;
const MAX_TEXT = 5000;
const MAX_POINTS = 4000; // number of coordinates (2 per point)

export function objectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("objects");
}

const num = (v: unknown, fallback: number, min = -LIMIT, max = LIMIT) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

export function readObject(id: string, m: Y.Map<unknown>): WbObject | null {
  const type = m.get("type");
  if (!(WB_OBJECT_TYPES as readonly unknown[]).includes(type)) return null;
  const color = m.get("color");
  const obj: WbObject = {
    id,
    type: type as WbObjectType,
    x: num(m.get("x"), 0),
    y: num(m.get("y"), 0),
    w: num(m.get("w"), 160, 4, 20_000),
    h: num(m.get("h"), 120, 4, 20_000),
    text: typeof m.get("text") === "string" ? (m.get("text") as string).slice(0, MAX_TEXT) : "",
    color: (WB_COLORS as readonly unknown[]).includes(color) ? (color as WbColor) : "yellow",
    z: num(m.get("z"), 0),
  };
  const fontSize = m.get("fontSize");
  if (typeof fontSize === "number") obj.fontSize = num(fontSize, defaultFontSize(obj.type), WB_FONT_MIN, WB_FONT_MAX);
  if (obj.type === "connector") {
    const from = m.get("from");
    const to = m.get("to");
    if (typeof from !== "string" || typeof to !== "string") return null;
    obj.from = from;
    obj.to = to;
  }
  if (obj.type === "path") {
    const pts = m.get("points");
    if (!Array.isArray(pts)) return null;
    obj.points = pts.filter((p): p is number => typeof p === "number" && Number.isFinite(p)).slice(0, MAX_POINTS);
    obj.strokeWidth = num(m.get("strokeWidth"), 3, 1, 40);
  }
  return obj;
}

/** All valid objects, sorted by z then id. Connectors with a missing endpoint are dropped. */
export function readWhiteboard(doc: Y.Doc): WbObject[] {
  const all: WbObject[] = [];
  objectsMap(doc).forEach((m, id) => {
    if (!(m instanceof Y.Map)) return;
    const o = readObject(id, m);
    if (o) all.push(o);
  });
  const ids = new Set(all.map((o) => o.id));
  return all
    .filter((o) => o.type !== "connector" || (ids.has(o.from!) && ids.has(o.to!)))
    .sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export function newObjectId(): string {
  return `o_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function nextZ(doc: Y.Doc): number {
  let max = 0;
  objectsMap(doc).forEach((m) => {
    const z = m.get("z");
    if (typeof z === "number" && z > max) max = z;
  });
  return max + 1;
}

export type NewWbObject = Omit<WbObject, "id" | "z"> & { id?: string };

export function addObject(doc: Y.Doc, data: NewWbObject): string {
  const id = data.id ?? newObjectId();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set("type", data.type);
    m.set("x", num(data.x, 0));
    m.set("y", num(data.y, 0));
    m.set("w", num(data.w, 160, 4, 20_000));
    m.set("h", num(data.h, 120, 4, 20_000));
    m.set("text", data.text.slice(0, MAX_TEXT));
    m.set("color", data.color);
    m.set("z", nextZ(doc));
    if (data.fontSize !== undefined) m.set("fontSize", num(data.fontSize, defaultFontSize(data.type), WB_FONT_MIN, WB_FONT_MAX));
    if (data.type === "connector") {
      m.set("from", data.from);
      m.set("to", data.to);
    }
    if (data.type === "path") {
      m.set("points", (data.points ?? []).slice(0, MAX_POINTS));
      m.set("strokeWidth", num(data.strokeWidth, 3, 1, 40));
    }
    objectsMap(doc).set(id, m);
  });
  return id;
}

export type WbPatch = Partial<Pick<WbObject, "x" | "y" | "w" | "h" | "text" | "color" | "fontSize">>;

export function updateObjects(doc: Y.Doc, patches: Record<string, WbPatch>): void {
  const objects = objectsMap(doc);
  doc.transact(() => {
    for (const [id, patch] of Object.entries(patches)) {
      const m = objects.get(id);
      if (!m) continue;
      if (patch.x !== undefined) m.set("x", num(patch.x, 0));
      if (patch.y !== undefined) m.set("y", num(patch.y, 0));
      if (patch.w !== undefined) m.set("w", num(patch.w, 160, 4, 20_000));
      if (patch.h !== undefined) m.set("h", num(patch.h, 120, 4, 20_000));
      if (patch.text !== undefined) m.set("text", patch.text.slice(0, MAX_TEXT));
      if (patch.fontSize !== undefined) m.set("fontSize", num(patch.fontSize, 15, WB_FONT_MIN, WB_FONT_MAX));
      if (patch.color !== undefined && (WB_COLORS as readonly string[]).includes(patch.color)) {
        m.set("color", patch.color);
      }
    }
  });
}

export function bringToFront(doc: Y.Doc, ids: readonly string[]): void {
  const objects = objectsMap(doc);
  doc.transact(() => {
    let z = nextZ(doc);
    for (const id of ids) objects.get(id)?.set("z", z++);
  });
}

/** Delete objects plus any connectors attached to them. */
export function deleteObjects(doc: Y.Doc, ids: readonly string[]): void {
  const objects = objectsMap(doc);
  const doomed = new Set(ids);
  objects.forEach((m, id) => {
    if (m.get("type") === "connector" && (doomed.has(m.get("from") as string) || doomed.has(m.get("to") as string))) {
      doomed.add(id);
    }
  });
  doc.transact(() => {
    for (const id of doomed) objects.delete(id);
  });
}

/** Centre point of an object, used for connector routing. */
export function centerOf(o: Pick<WbObject, "x" | "y" | "w" | "h">): { x: number; y: number } {
  return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
}
