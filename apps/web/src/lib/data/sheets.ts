import type { SupabaseClient } from "@supabase/supabase-js";
import { SHEET_MAX_COLS, SHEET_MAX_ROWS, cleanFormat, type CellFormat } from "@collabverse/shared/sheet";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
export type SheetCell = Tables<"sheet_cells">;
export const MAX_CELL_LENGTH = 2000;

export async function loadSheetCells(sb: Client, sheetId: string): Promise<SheetCell[]> {
  // A full 1000 × 52 grid is 52,000 cells; page through to load them all.
  const all: SheetCell[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("sheet_cells").select("*").eq("sheet_id", sheetId).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

/** Sets one cell (an empty value clears it, keeping the row so others see the change live). */
export async function setSheetCell(
  sb: Client,
  ids: { workspaceId: string; sheetId: string },
  row: number,
  col: number,
  value: string,
): Promise<SheetCell> {
  if (row < 0 || row >= SHEET_MAX_ROWS || col < 0 || col >= SHEET_MAX_COLS) throw new Error("That cell is outside the sheet.");
  if (value.length > MAX_CELL_LENGTH) throw new Error(`A cell can hold at most ${MAX_CELL_LENGTH} characters.`);
  const { data, error } = await sb
    .from("sheet_cells")
    .upsert({ workspace_id: ids.workspaceId, sheet_id: ids.sheetId, row_index: row, col_index: col, value }, { onConflict: "sheet_id,row_index,col_index" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function resizeSheet(sb: Client, sheetId: string, size: { rows?: number; cols?: number }): Promise<void> {
  const update: Database["public"]["Tables"]["sheets"]["Update"] = {};
  if (size.rows !== undefined) update.row_count = Math.min(Math.max(size.rows, 1), SHEET_MAX_ROWS);
  if (size.cols !== undefined) update.col_count = Math.min(Math.max(size.cols, 1), SHEET_MAX_COLS);
  const { data, error } = await sb.from("sheets").update(update).eq("id", sheetId).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this sheet.");
}

export interface CellWrite {
  row: number;
  col: number;
  value: string;
}

const BATCH = 500;

function checkPos(row: number, col: number) {
  if (row < 0 || row >= SHEET_MAX_ROWS || col < 0 || col >= SHEET_MAX_COLS) throw new Error("That cell is outside the sheet.");
}

/** Writes many cell values (paste, fill, sort, import), in batches. Formats are left as they are. */
export async function setSheetValues(sb: Client, ids: { workspaceId: string; sheetId: string }, writes: CellWrite[]): Promise<SheetCell[]> {
  const saved: SheetCell[] = [];
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = writes.slice(i, i + BATCH).map((w) => {
      checkPos(w.row, w.col);
      if (w.value.length > MAX_CELL_LENGTH) throw new Error(`A cell can hold at most ${MAX_CELL_LENGTH} characters.`);
      return { workspace_id: ids.workspaceId, sheet_id: ids.sheetId, row_index: w.row, col_index: w.col, value: w.value };
    });
    const { data, error } = await sb.from("sheet_cells").upsert(batch, { onConflict: "sheet_id,row_index,col_index" }).select("*");
    if (error) throw error;
    saved.push(...data);
  }
  return saved;
}

/** Sets the format of many cells (values are left as they are). */
export async function setSheetFormats(
  sb: Client,
  ids: { workspaceId: string; sheetId: string },
  cells: { row: number; col: number; format: CellFormat }[],
): Promise<SheetCell[]> {
  const saved: SheetCell[] = [];
  for (let i = 0; i < cells.length; i += BATCH) {
    const batch = cells.slice(i, i + BATCH).map((c) => {
      checkPos(c.row, c.col);
      return { workspace_id: ids.workspaceId, sheet_id: ids.sheetId, row_index: c.row, col_index: c.col, format: cleanFormat(c.format) as Json };
    });
    const { data, error } = await sb.from("sheet_cells").upsert(batch, { onConflict: "sheet_id,row_index,col_index" }).select("*");
    if (error) throw error;
    saved.push(...data);
  }
  return saved;
}

/** Inserts (delta > 0) or deletes (delta < 0) rows or columns at `at`. */
export async function shiftSheet(sb: Client, sheetId: string, axis: "row" | "col", at: number, delta: number): Promise<void> {
  const { error } = await sb.rpc("sheet_shift", { p_sheet_id: sheetId, p_axis: axis, p_at: at, p_delta: delta });
  if (error) throw error;
}

export async function updateSheetLayout(sb: Client, sheetId: string, layout: { colWidths?: Record<string, number>; frozenRows?: number }): Promise<void> {
  const update: Database["public"]["Tables"]["sheets"]["Update"] = {};
  if (layout.colWidths) update.col_widths = layout.colWidths;
  if (layout.frozenRows !== undefined) update.frozen_rows = Math.min(Math.max(layout.frozenRows, 0), 10);
  const { data, error } = await sb.from("sheets").update(update).eq("id", sheetId).select("id");
  if (error) throw error;
  if (!data.length) throw new Error("You don't have permission to change this sheet.");
}
