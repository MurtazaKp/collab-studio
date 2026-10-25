import type { CellFormat } from "@collabverse/shared/sheet";

export type Pos = { row: number; col: number };
export type Rect = { top: number; left: number; bottom: number; right: number };

export const cellKey = (row: number, col: number) => `${row}:${col}`;

export function rectOf(a: Pos, b: Pos): Rect {
  return { top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row), left: Math.min(a.col, b.col), right: Math.max(a.col, b.col) };
}

export function inRect(r: Rect, row: number, col: number): boolean {
  return row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
}

export function rectCells(r: Rect): Pos[] {
  const out: Pos[] = [];
  for (let row = r.top; row <= r.bottom; row++) for (let col = r.left; col <= r.right; col++) out.push({ row, col });
  return out;
}

/** Inline style for a cell's format (colours are validated hex values). */
export function formatStyle(f: CellFormat, numeric: boolean): React.CSSProperties {
  return {
    fontWeight: f.b ? 600 : undefined,
    fontStyle: f.i ? "italic" : undefined,
    color: f.color,
    background: f.fill,
    textAlign: f.align ?? (numeric ? "right" : "left"),
  };
}

/** Saves text as a file in the browser. */
export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A safe file name from a sheet title. */
export function fileNameFor(title: string, ext: string): string {
  const base = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "sheet";
  return `${base.slice(0, 60)}.${ext}`;
}

export const TEXT_COLORS = ["#1b1a17", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#6b7280"];
export const FILL_COLORS = ["#fef08a", "#fed7aa", "#fecaca", "#bbf7d0", "#a5f3fc", "#bfdbfe", "#ddd6fe", "#fbcfe8", "#e5e7eb", "#f3f4f6"];
