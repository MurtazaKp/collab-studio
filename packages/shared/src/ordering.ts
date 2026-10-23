import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * Ordered lists (Kanban columns and tasks, playlist items, shopping items) use
 * fractional index keys stored in a text `position` column. Moving an item only
 * rewrites that one row, so concurrent moves of different items never conflict.
 * Two clients that pick the same key concurrently are tie-broken by id.
 */
export interface Positioned {
  id: string;
  position: string;
}

export function comparePositioned(a: Positioned, b: Positioned): number {
  // Byte-wise comparison matches PostgreSQL `COLLATE "C"` ordering of the column.
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
  return [...items].sort(comparePositioned);
}

export function positionAtEnd(items: readonly Positioned[]): string {
  const sorted = sortByPosition(items);
  const last = sorted[sorted.length - 1];
  return generateKeyBetween(last ? last.position : null, null);
}

export function positionAtStart(items: readonly Positioned[]): string {
  const sorted = sortByPosition(items);
  const first = sorted[0];
  return generateKeyBetween(null, first ? first.position : null);
}

/**
 * Key for inserting `movingId` at `targetIndex` of `items` (the list it is moving
 * into, which may or may not already contain it).
 */
export function positionForIndex(
  items: readonly Positioned[],
  targetIndex: number,
  movingId?: string,
): string {
  const others = sortByPosition(items.filter((i) => i.id !== movingId));
  const index = Math.max(0, Math.min(targetIndex, others.length));
  const before = others[index - 1]?.position ?? null;
  let after = others[index]?.position ?? null;
  // Equal neighbours (from a concurrent tie) leave no gap; place after the pair.
  if (before !== null && after !== null && before >= after) after = null;
  if (before !== null && after === null) {
    const next = others.slice(index).find((o) => o.position > before);
    return generateKeyBetween(before, next ? next.position : null);
  }
  return generateKeyBetween(before, after);
}

export function initialPositions(count: number): string[] {
  return generateNKeysBetween(null, null, count);
}

export const POSITION_RE = /^[0-9A-Za-z]{1,128}$/;
