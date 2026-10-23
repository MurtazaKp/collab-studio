import * as Y from "yjs";

/**
 * Shared mindmap model.
 *
 * Y.Doc layout:  doc.getMap("nodes")  id -> Y.Map { label, parentId, x, y, color }
 *
 * Connectors are derived from `parentId`, so an edge can never reference a
 * missing node. Each field is its own Y.Map entry, so one user moving a node
 * while another renames it both survive. Concurrent structural edits can still
 * produce orphans (child added under a node someone else deleted) or cycles
 * (two users reparenting into each other); `normalizeMindmap` resolves both
 * deterministically, so every client renders the same tree.
 */

export const MINDMAP_ROOT_ID = "root";
export const MINDMAP_COLORS = ["iris", "teal", "amber", "rose", "sky", "lime", "slate"] as const;
export type MindmapColor = (typeof MINDMAP_COLORS)[number];

export interface MindmapNodeData {
  id: string;
  label: string;
  parentId: string | null;
  x: number;
  y: number;
  color: MindmapColor;
}

export interface MindmapEdge {
  id: string;
  source: string;
  target: string;
}

export interface NormalizedMindmap {
  nodes: MindmapNodeData[];
  edges: MindmapEdge[];
  /** Nodes whose stored parent was missing or cyclic and were re-attached. */
  repaired: string[];
}

const MAX_LABEL = 200;
const COORD_LIMIT = 1_000_000;

export function nodesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>("nodes");
}

function finite(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, n))
    : fallback;
}

function color(c: unknown): MindmapColor {
  return (MINDMAP_COLORS as readonly unknown[]).includes(c) ? (c as MindmapColor) : "iris";
}

export function readNode(id: string, m: Y.Map<unknown>): MindmapNodeData {
  const label = m.get("label");
  const parentId = m.get("parentId");
  return {
    id,
    label: typeof label === "string" ? label.slice(0, MAX_LABEL) : "",
    parentId: id === MINDMAP_ROOT_ID ? null : typeof parentId === "string" ? parentId : null,
    x: finite(m.get("x")),
    y: finite(m.get("y")),
    color: color(m.get("color")),
  };
}

export function readMindmap(doc: Y.Doc): MindmapNodeData[] {
  const out: MindmapNodeData[] = [];
  nodesMap(doc).forEach((m, id) => {
    if (m instanceof Y.Map) out.push(readNode(id, m));
  });
  return out;
}

/** Resolve orphans and cycles deterministically; derive edges. */
export function normalizeMindmap(raw: readonly MindmapNodeData[]): NormalizedMindmap {
  const byId = new Map(raw.map((n) => [n.id, { ...n }]));
  const repaired: string[] = [];
  if (!byId.has(MINDMAP_ROOT_ID)) {
    byId.set(MINDMAP_ROOT_ID, {
      id: MINDMAP_ROOT_ID,
      label: "Central topic",
      parentId: null,
      x: 0,
      y: 0,
      color: "iris",
    });
  }
  // Orphans and stray roots attach to the root.
  for (const n of byId.values()) {
    if (n.id === MINDMAP_ROOT_ID) continue;
    if (n.parentId === null || !byId.has(n.parentId) || n.parentId === n.id) {
      n.parentId = MINDMAP_ROOT_ID;
      repaired.push(n.id);
    }
  }
  // Break cycles: walk up from each node; a cycle never reaches the root.
  const ids = [...byId.keys()].sort();
  const resolved = new Set<string>([MINDMAP_ROOT_ID]);
  for (const start of ids) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = start;
    while (cur !== null && !resolved.has(cur)) {
      if (onPath.has(cur)) {
        const cycle = path.slice(path.indexOf(cur)).sort();
        const breaker = cycle[0]!;
        byId.get(breaker)!.parentId = MINDMAP_ROOT_ID;
        repaired.push(breaker);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = byId.get(cur)!.parentId;
    }
    for (const p of path) resolved.add(p);
  }
  const nodes = [...byId.values()].sort((a, b) =>
    a.id === MINDMAP_ROOT_ID ? -1 : b.id === MINDMAP_ROOT_ID ? 1 : a.id < b.id ? -1 : 1,
  );
  const edges = nodes
    .filter((n) => n.parentId !== null)
    .map((n) => ({ id: `${n.parentId}->${n.id}`, source: n.parentId!, target: n.id }));
  return { nodes, edges, repaired };
}

export function isDescendant(
  nodes: readonly MindmapNodeData[],
  candidate: string,
  ancestor: string,
): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = byId.get(candidate)?.parentId ?? null;
  const seen = new Set<string>();
  while (cur !== null && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export function newNodeId(): string {
  return `n_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function seedMindmap(doc: Y.Doc, title: string): void {
  const nodes = nodesMap(doc);
  if (nodes.has(MINDMAP_ROOT_ID)) return;
  doc.transact(() => {
    const root = new Y.Map<unknown>();
    root.set("label", title.slice(0, MAX_LABEL) || "Central topic");
    root.set("parentId", null);
    root.set("x", 0);
    root.set("y", 0);
    root.set("color", "iris");
    nodes.set(MINDMAP_ROOT_ID, root);
  });
}

export function addChildNode(
  doc: Y.Doc,
  parentId: string,
  data: { label?: string; x: number; y: number; color?: MindmapColor },
): string {
  const nodes = nodesMap(doc);
  // The canvas always shows a root (normalizeMindmap adds a placeholder if the
  // map lost it), so make that root real before attaching children to it.
  if (parentId === MINDMAP_ROOT_ID && !nodes.has(MINDMAP_ROOT_ID)) seedMindmap(doc, "Central topic");
  if (!nodes.has(parentId)) throw new Error("Parent node does not exist");
  const id = newNodeId();
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set("label", (data.label ?? "New idea").slice(0, MAX_LABEL));
    m.set("parentId", parentId);
    m.set("x", finite(data.x));
    m.set("y", finite(data.y));
    m.set("color", color(data.color ?? readNode(parentId, nodes.get(parentId)!).color));
    nodes.set(id, m);
  });
  return id;
}

export function updateNode(
  doc: Y.Doc,
  id: string,
  patch: Partial<Pick<MindmapNodeData, "label" | "x" | "y" | "color">>,
): void {
  const m = nodesMap(doc).get(id);
  if (!m) return;
  doc.transact(() => {
    if (patch.label !== undefined) m.set("label", patch.label.slice(0, MAX_LABEL));
    if (patch.x !== undefined) m.set("x", finite(patch.x));
    if (patch.y !== undefined) m.set("y", finite(patch.y));
    if (patch.color !== undefined) m.set("color", color(patch.color));
  });
}

/** Reparent a node; rejects moves that would create a cycle or move the root. */
export function reparentNode(doc: Y.Doc, id: string, newParentId: string): boolean {
  if (id === MINDMAP_ROOT_ID || id === newParentId) return false;
  const nodes = nodesMap(doc);
  const m = nodes.get(id);
  if (!m || !nodes.has(newParentId)) return false;
  const current = normalizeMindmap(readMindmap(doc)).nodes;
  if (isDescendant(current, newParentId, id)) return false;
  m.set("parentId", newParentId);
  return true;
}

/** Delete a node and its whole subtree in one transaction. */
export function deleteNode(doc: Y.Doc, id: string): string[] {
  if (id === MINDMAP_ROOT_ID) return [];
  const nodes = nodesMap(doc);
  const all = normalizeMindmap(readMindmap(doc)).nodes;
  const removed = all.filter((n) => n.id === id || isDescendant(all, n.id, id)).map((n) => n.id);
  doc.transact(() => {
    for (const r of removed) nodes.delete(r);
  });
  return removed;
}
