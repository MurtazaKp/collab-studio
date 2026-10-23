import { MINDMAP_ROOT_ID, type MindmapNodeData } from "@collabverse/shared/mindmap";

const X_GAP = 240;
const Y_GAP = 64;

/**
 * Tidy left-to-right tree layout: each leaf takes one row, parents centre on
 * their children. Pure, so every client computes identical positions.
 */
export function tidyLayout(nodes: readonly MindmapNodeData[]): Record<string, { x: number; y: number }> {
  const children = new Map<string, MindmapNodeData[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  }
  for (const list of children.values()) list.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));

  const out: Record<string, { x: number; y: number }> = {};
  let row = 0;
  const visit = (id: string, depth: number, seen: Set<string>): number => {
    if (seen.has(id)) return row * Y_GAP;
    seen.add(id);
    const kids = children.get(id) ?? [];
    let y: number;
    if (kids.length === 0) {
      y = row * Y_GAP;
      row += 1;
    } else {
      const ys = kids.map((k) => visit(k.id, depth + 1, seen));
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    out[id] = { x: depth * X_GAP, y };
    return y;
  };
  visit(MINDMAP_ROOT_ID, 0, new Set());
  // Centre the tree vertically on the root.
  const rootY = out[MINDMAP_ROOT_ID]?.y ?? 0;
  for (const id of Object.keys(out)) out[id] = { x: out[id]!.x, y: Math.round(out[id]!.y - rootY) };
  return out;
}

/** Suggested position for a new child: to the right of the parent, below its last child. */
export function childPosition(nodes: readonly MindmapNodeData[], parentId: string): { x: number; y: number } {
  const parent = nodes.find((n) => n.id === parentId);
  const siblings = nodes.filter((n) => n.parentId === parentId);
  const px = parent?.x ?? 0;
  const py = parent?.y ?? 0;
  if (!siblings.length) return { x: px + X_GAP, y: py };
  const lowest = Math.max(...siblings.map((s) => s.y));
  return { x: px + X_GAP, y: lowest + Y_GAP };
}
