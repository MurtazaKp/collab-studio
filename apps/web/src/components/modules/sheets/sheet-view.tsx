"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Plus, X } from "lucide-react";
import {
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  SheetEvaluator,
  cellName,
  cleanFormat,
  columnName,
  displayValue,
  formatCellValue,
  parseDelimited,
  shiftFormula,
  toDelimited,
  type CellFormat,
  type NumberFormat,
} from "@collabverse/shared/sheet";
import { useWorkspace } from "@/lib/workspace-context";
import { useLiveRows } from "@/lib/realtime/live-rows";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { toastError } from "@/lib/notify-error";
import {
  MAX_CELL_LENGTH,
  loadSheetCells,
  resizeSheet,
  setSheetFormats,
  setSheetValues,
  shiftSheet,
  updateSheetLayout,
  type CellWrite,
  type SheetCell,
} from "@/lib/data/sheets";
import type { ItemRow } from "@/lib/data/items";
import { EditableTitle, useLiveItem } from "@/components/modules/collab-chrome";
import { PageHeader } from "@/components/shell/page-header";
import { ModuleIcon } from "@/components/ui/module-icon";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import { SheetToolbar, type ToolbarActions } from "./sheet-toolbar";
import { cellKey, downloadText, fileNameFor, formatStyle, inRect, rectCells, rectOf, type Pos } from "./sheet-utils";

const ROW_H = 28;
const DEFAULT_W = 120;
const MIN_W = 40;
const HEAD_W = 48;
const OVERSCAN = 10;

type SheetRow = ItemRow & { row_count: number; col_count: number; col_widths: Record<string, number> | null; frozen_rows: number };

/**
 * What we last copied, so pasting back into a sheet (this one or another) keeps
 * formulas, shifting their references, and formats.
 */
type CopiedBlock = { text: string; origin: Pos; raw: string[][]; formats: CellFormat[][] };
let lastCopy: CopiedBlock | null = null;
const rememberCopy = (block: CopiedBlock) => {
  lastCopy = block;
};
const copiedFor = (text: string): CopiedBlock | null => (lastCopy && lastCopy.text === text ? lastCopy : null);

export function SheetView({ sheet: initialSheet, initialCells }: { sheet: ItemRow; initialCells: SheetCell[] }) {
  const router = useRouter();
  const { workspace, canEdit, href } = useWorkspace();
  const sb = getBrowserSupabase();
  const { item, deleted } = useLiveItem("sheets", initialSheet);
  const sheet = item as SheetRow;
  const ids = useMemo(() => ({ workspaceId: workspace.id, sheetId: initialSheet.id }), [workspace.id, initialSheet.id]);
  const rows = sheet.row_count ?? 100;
  const cols = sheet.col_count ?? 26;
  const frozen = Math.min(sheet.frozen_rows ?? 0, rows);

  // ------------------------------------------------------------ data
  const load = useCallback(() => loadSheetCells(sb, initialSheet.id), [sb, initialSheet.id]);
  const { rows: cellRows, setRows, reload, status } = useLiveRows({ table: "sheet_cells", filter: `sheet_id=eq.${initialSheet.id}`, load, initial: initialCells });
  const cells = useMemo(() => new Map(cellRows.map((c) => [cellKey(c.row_index, c.col_index), c])), [cellRows]);
  const raw = useCallback((r: number, c: number) => cells.get(cellKey(r, c))?.value ?? "", [cells]);
  const fmt = useCallback((r: number, c: number): CellFormat => cleanFormat(cells.get(cellKey(r, c))?.format), [cells]);
  const evaluator = useMemo(() => new SheetEvaluator(raw), [raw]);
  const shown = useCallback((r: number, c: number) => displayValue(evaluator.value(r, c), fmt(r, c).num), [evaluator, fmt]);

  /** Applies saved rows locally (the live feed confirms them too). */
  const merge = useCallback(
    (saved: SheetCell[]) =>
      setRows((current) => {
        const byKey = new Map(current.map((c) => [cellKey(c.row_index, c.col_index), c]));
        for (const s of saved) byKey.set(cellKey(s.row_index, s.col_index), s);
        return [...byKey.values()];
      }),
    [setRows],
  );

  // ------------------------------------------------------------ layout
  const [dragWidths, setDragWidths] = useState<Record<string, number> | null>(null);
  const widths = useMemo(() => {
    const saved = dragWidths ?? sheet.col_widths ?? {};
    return Array.from({ length: cols }, (_, c) => Math.max(MIN_W, Number(saved[String(c)]) || DEFAULT_W));
  }, [cols, sheet.col_widths, dragWidths]);
  const lefts = useMemo(() => widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? 0) + w], [0]), [widths]);
  const totalW = lefts[cols] ?? 0;

  // ------------------------------------------------------------ selection
  const [anchor, setAnchor] = useState<Pos>({ row: 0, col: 0 });
  const [active, setActive] = useState<Pos>({ row: 0, col: 0 });
  const range = rectOf(anchor, active);
  const [draft, setDraft] = useState<string | null>(null);
  const dragging = useRef(false);

  // ------------------------------------------------------------ filter (per viewer)
  const [filterOn, setFilterOn] = useState(false);
  const [filterCol, setFilterCol] = useState(0);
  const [filterText, setFilterText] = useState("");
  const bodyRows = useMemo(() => {
    const all = Array.from({ length: Math.max(rows - frozen, 0) }, (_, i) => frozen + i);
    const q = filterText.trim().toLowerCase();
    if (!filterOn || !q) return all;
    return all.filter((r) => shown(r, filterCol).toLowerCase().includes(q));
  }, [rows, frozen, filterOn, filterText, filterCol, shown]);

  // ------------------------------------------------------------ virtual scrolling
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (draft !== null) editor.current?.focus();
  }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const [confirm, setConfirm] = useState<{ title: string; description: string; run: () => Promise<void> } | null>(null);

  if (deleted) {
    return (
      <EmptyState
        icon={<FileSpreadsheet />}
        title="This sheet was deleted"
        action={<Button variant="outline" onClick={() => router.push(href("sheets"))}>Back to sheets</Button>}
      />
    );
  }

  const headerH = (1 + frozen) * ROW_H;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(bodyRows.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  // ------------------------------------------------------------ writes
  const writeValues = async (writes: CellWrite[]) => {
    if (!writes.length) return;
    // Optimistic: show now, keep each cell's format.
    merge(
      writes.map((w) => {
        const existing = cells.get(cellKey(w.row, w.col));
        return existing
          ? { ...existing, value: w.value }
          : { id: `local-${cellKey(w.row, w.col)}`, workspace_id: workspace.id, sheet_id: sheet.id, row_index: w.row, col_index: w.col, value: w.value, format: {}, updated_by: null, updated_at: new Date().toISOString() };
      }),
    );
    try {
      merge(await setSheetValues(sb, ids, writes));
    } catch (err) {
      toastError(err);
      void reload();
    }
  };

  const writeFormats = async (list: { row: number; col: number; format: CellFormat }[]) => {
    if (!list.length) return;
    merge(
      list.map((f) => {
        const existing = cells.get(cellKey(f.row, f.col));
        return existing
          ? { ...existing, format: f.format as never }
          : { id: `local-${cellKey(f.row, f.col)}`, workspace_id: workspace.id, sheet_id: sheet.id, row_index: f.row, col_index: f.col, value: "", format: f.format as never, updated_by: null, updated_at: new Date().toISOString() };
      }),
    );
    try {
      merge(await setSheetFormats(sb, ids, list));
    } catch (err) {
      toastError(err);
      void reload();
    }
  };

  /** Applies a change to the format of every selected cell. */
  const formatRange = (change: (f: CellFormat) => CellFormat) =>
    void writeFormats(rectCells(range).map((p) => ({ ...p, format: cleanFormat(change({ ...fmt(p.row, p.col) })) })));

  const ensureSize = async (needRows: number, needCols: number) => {
    const r = Math.min(Math.max(rows, needRows), SHEET_MAX_ROWS);
    const c = Math.min(Math.max(cols, needCols), SHEET_MAX_COLS);
    if (r !== rows || c !== cols) await resizeSheet(sb, sheet.id, { rows: r, cols: c });
  };

  // ------------------------------------------------------------ navigation
  const scrollToRow = (row: number) => {
    const el = scroller.current;
    const idx = bodyRows.indexOf(row);
    if (!el || idx < 0) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - headerH) el.scrollTop = top + ROW_H - (el.clientHeight - headerH);
  };

  const moveTo = (pos: Pos, extend: boolean) => {
    const next = { row: Math.min(Math.max(pos.row, 0), rows - 1), col: Math.min(Math.max(pos.col, 0), cols - 1) };
    setActive(next);
    if (!extend) setAnchor(next);
    scrollToRow(next.row);
  };

  const step = (dr: number, dc: number, extend: boolean) => {
    // Up/down follow the visible (filtered) rows.
    let row = active.row;
    if (dr !== 0) {
      const order = [...Array.from({ length: frozen }, (_, i) => i), ...bodyRows];
      const at = order.indexOf(active.row);
      row = order[Math.min(Math.max(at + dr, 0), order.length - 1)] ?? active.row;
    }
    moveTo({ row, col: active.col + dc }, extend);
  };

  const commitDraft = (then?: () => void) => {
    if (draft !== null && draft !== raw(active.row, active.col)) void writeValues([{ row: active.row, col: active.col, value: draft.slice(0, MAX_CELL_LENGTH) }]);
    setDraft(null);
    then?.();
    grid.current?.focus();
  };

  // ------------------------------------------------------------ clipboard, fill, clear
  const copyRange = (e: React.ClipboardEvent, cut: boolean) => {
    if (draft !== null) return;
    e.preventDefault();
    const rawRows: string[][] = [];
    const shownRows: string[][] = [];
    const formats: CellFormat[][] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const rr: string[] = [];
      const sr: string[] = [];
      const fr: CellFormat[] = [];
      for (let c = range.left; c <= range.right; c++) {
        rr.push(raw(r, c));
        sr.push(raw(r, c).startsWith("=") ? formatCellValue(evaluator.value(r, c)) : raw(r, c));
        fr.push(fmt(r, c));
      }
      rawRows.push(rr);
      shownRows.push(sr);
      formats.push(fr);
    }
    const text = toDelimited(shownRows, "\t");
    e.clipboardData.setData("text/plain", text);
    rememberCopy({ text, origin: { row: range.top, col: range.left }, raw: rawRows, formats });
    if (cut && canEdit) void writeValues(rectCells(range).map((p) => ({ ...p, value: "" })));
  };

  const paste = async (e: React.ClipboardEvent) => {
    if (draft !== null || !canEdit) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const ours = copiedFor(text);
    const block = ours ? ours.raw : parseDelimited(text.replace(/\r?\n$/, ""), "\t");
    const at = { row: range.top, col: range.left };
    const height = block.length;
    const width = Math.max(...block.map((r) => r.length));
    if (at.row + height > SHEET_MAX_ROWS || at.col + width > SHEET_MAX_COLS) {
      toastError(`That doesn't fit: sheets can have up to ${SHEET_MAX_ROWS} rows and ${SHEET_MAX_COLS} columns.`);
      return;
    }
    try {
      await ensureSize(at.row + height, at.col + width);
    } catch (err) {
      toastError(err);
      return;
    }
    const dr = ours ? at.row - ours.origin.row : 0;
    const dc = ours ? at.col - ours.origin.col : 0;
    const writes: CellWrite[] = [];
    block.forEach((r, i) => r.forEach((v, j) => writes.push({ row: at.row + i, col: at.col + j, value: (ours ? shiftFormula(v, dr, dc) : v).slice(0, MAX_CELL_LENGTH) })));
    await writeValues(writes);
    if (ours) await writeFormats(ours.formats.flatMap((r, i) => r.map((f, j) => ({ row: at.row + i, col: at.col + j, format: f }))));
    setAnchor(at);
    setActive({ row: at.row + height - 1, col: at.col + width - 1 });
  };

  const fill = (direction: "down" | "right") => {
    const writes: CellWrite[] = [];
    if (direction === "down") {
      if (range.bottom === range.top) return;
      for (let c = range.left; c <= range.right; c++)
        for (let r = range.top + 1; r <= range.bottom; r++) writes.push({ row: r, col: c, value: shiftFormula(raw(range.top, c), r - range.top, 0) });
    } else {
      if (range.right === range.left) return;
      for (let r = range.top; r <= range.bottom; r++)
        for (let c = range.left + 1; c <= range.right; c++) writes.push({ row: r, col: c, value: shiftFormula(raw(r, range.left), 0, c - range.left) });
    }
    void writeValues(writes);
  };

  const clearRange = () => void writeValues(rectCells(range).filter((p) => raw(p.row, p.col) !== "").map((p) => ({ ...p, value: "" })));

  // ------------------------------------------------------------ structure, sort, import/export
  const structural = async (work: () => Promise<void>) => {
    try {
      await work();
      await reload();
    } catch (err) {
      toastError(err);
    }
  };

  /** Last row with content (for sort and export). */
  const usedBottom = () => cellRows.reduce((m, c) => (c.value !== "" ? Math.max(m, c.row_index) : m), -1);
  const usedRight = () => cellRows.reduce((m, c) => (c.value !== "" ? Math.max(m, c.col_index) : m), -1);

  const sortBy = (dir: "asc" | "desc") => {
    const top = frozen;
    const bottom = usedBottom();
    if (bottom <= top) return;
    const col = active.col;
    const order = Array.from({ length: bottom - top + 1 }, (_, i) => top + i);
    const keyOf = (r: number) => evaluator.value(r, col);
    order.sort((a, b) => {
      const x = keyOf(a);
      const y = keyOf(b);
      const ex = x === "";
      const ey = y === "";
      if (ex || ey) return ex === ey ? a - b : ex ? 1 : -1; // empties last
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return (dir === "asc" ? cmp : -cmp) || a - b;
    });
    const values: CellWrite[] = [];
    const formats: { row: number; col: number; format: CellFormat }[] = [];
    order.forEach((from, i) => {
      const to = top + i;
      if (from === to) return;
      for (let c = 0; c < cols; c++) {
        if (raw(from, c) !== raw(to, c)) values.push({ row: to, col: c, value: raw(from, c) });
        if (JSON.stringify(fmt(from, c)) !== JSON.stringify(fmt(to, c))) formats.push({ row: to, col: c, format: fmt(from, c) });
      }
    });
    void (async () => {
      await writeValues(values);
      await writeFormats(formats);
      toast.success(`Sorted by column ${columnName(col)}${frozen ? " (header row kept)" : ""}`);
    })();
  };

  const importCsv = async (file: File) => {
    if (file.size > 2_000_000) {
      toastError("That file is too large (2 MB at most).");
      return;
    }
    const data = parseDelimited(await file.text(), ",");
    if (!data.length) return;
    const at = { row: range.top, col: range.left };
    const height = Math.min(data.length, SHEET_MAX_ROWS - at.row);
    const width = Math.min(Math.max(...data.map((r) => r.length)), SHEET_MAX_COLS - at.col);
    await structural(async () => {
      await ensureSize(at.row + height, at.col + width);
      const writes: CellWrite[] = [];
      for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) writes.push({ row: at.row + i, col: at.col + j, value: (data[i]![j] ?? "").slice(0, MAX_CELL_LENGTH) });
      await setSheetValues(sb, ids, writes);
    });
    toast.success(`Imported ${height} row${height === 1 ? "" : "s"}${height < data.length || width < Math.max(...data.map((r) => r.length)) ? " (some data didn't fit and was left out)" : ""}`);
  };

  const exportCsv = () => {
    const bottom = usedBottom();
    const right = usedRight();
    const out: string[][] = [];
    for (let r = 0; r <= bottom; r++) out.push(Array.from({ length: right + 1 }, (_, c) => formatCellValue(evaluator.value(r, c))));
    downloadText(fileNameFor(sheet.title, "csv"), toDelimited(out, ","), "text/csv;charset=utf-8");
  };

  // ------------------------------------------------------------ toolbar
  const af = fmt(active.row, active.col);
  const actions: ToolbarActions = {
    toggleBold: () => {
      const on = !rectCells(range).every((p) => fmt(p.row, p.col).b);
      formatRange((f) => ({ ...f, b: on || undefined }));
    },
    toggleItalic: () => {
      const on = !rectCells(range).every((p) => fmt(p.row, p.col).i);
      formatRange((f) => ({ ...f, i: on || undefined }));
    },
    setAlign: (a) => formatRange((f) => ({ ...f, align: f.align === a && af.align === a ? undefined : a })),
    setNum: (n: NumberFormat) => formatRange((f) => ({ ...f, num: n === "auto" ? undefined : n })),
    setColor: (c) => formatRange((f) => ({ ...f, color: c ?? undefined })),
    setFill: (c) => formatRange((f) => ({ ...f, fill: c ?? undefined })),
    clearFormat: () => formatRange(() => ({})),
    insertRow: (where) => void structural(() => shiftSheet(sb, sheet.id, "row", where === "above" ? range.top : range.bottom + 1, 1)),
    insertCol: (where) => void structural(() => shiftSheet(sb, sheet.id, "col", where === "left" ? range.left : range.right + 1, 1)),
    deleteRows: () => {
      const n = range.bottom - range.top + 1;
      setConfirm({
        title: `Delete ${n === 1 ? `row ${range.top + 1}` : `rows ${range.top + 1}–${range.bottom + 1}`}?`,
        description: "Their contents are removed for everyone and the rows below move up. Formulas elsewhere aren't adjusted.",
        run: () => structural(() => shiftSheet(sb, sheet.id, "row", range.top, -n)),
      });
    },
    deleteCols: () => {
      const n = range.right - range.left + 1;
      setConfirm({
        title: `Delete ${n === 1 ? `column ${columnName(range.left)}` : `columns ${columnName(range.left)}–${columnName(range.right)}`}?`,
        description: "Their contents are removed for everyone and the columns to the right move left. Formulas elsewhere aren't adjusted.",
        run: () => structural(() => shiftSheet(sb, sheet.id, "col", range.left, -n)),
      });
    },
    toggleFreeze: () => void updateSheetLayout(sb, sheet.id, { frozenRows: frozen ? 0 : 1 }).catch(toastError),
    sort: sortBy,
    toggleFilter: () => {
      setFilterOn((on) => !on);
      setFilterCol(active.col);
    },
    importCsv: (f) => void importCsv(f),
    exportCsv,
  };

  // ------------------------------------------------------------ keyboard
  const onGridKey = (e: React.KeyboardEvent) => {
    if (draft !== null) return;
    const mod = e.ctrlKey || e.metaKey;
    const nav: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (nav[e.key]) {
      e.preventDefault();
      step(...nav[e.key]!, e.shiftKey);
    } else if (e.key === "Tab") {
      e.preventDefault();
      step(0, e.shiftKey ? -1 : 1, false);
    } else if (e.key === "Escape") {
      setAnchor(active);
    } else if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ row: 0, col: 0 });
      setActive({ row: rows - 1, col: cols - 1 });
    } else if (!canEdit) {
      return;
    } else if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      actions.toggleBold();
    } else if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      actions.toggleItalic();
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      fill("down");
    } else if (mod && e.key.toLowerCase() === "r") {
      e.preventDefault();
      fill("right");
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setAnchor(active);
      setDraft(raw(active.row, active.col));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearRange();
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setAnchor(active);
      setDraft(e.key);
    }
  };

  // ------------------------------------------------------------ column resize
  const startResize = (col: number, e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col]!;
    const base = { ...(sheet.col_widths ?? {}) };
    let latest = base;
    const onMove = (ev: PointerEvent) => {
      latest = { ...base, [String(col)]: Math.round(Math.min(Math.max(startW + ev.clientX - startX, MIN_W), 600)) };
      setDragWidths(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      void updateSheetLayout(sb, sheet.id, { colWidths: latest })
        .catch(toastError)
        .finally(() => setDragWidths(null));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ------------------------------------------------------------ rendering
  const selectCell = (r: number, c: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (draft !== null) commitDraft();
    if (e.shiftKey) setActive({ row: r, col: c });
    else {
      setAnchor({ row: r, col: c });
      setActive({ row: r, col: c });
    }
    dragging.current = true;
    grid.current?.focus();
  };

  const renderRow = (r: number, top: number | null) => (
    <div
      key={r}
      role="row"
      aria-rowindex={r + 2}
      className={cn("flex", top !== null && "absolute")}
      style={{ height: ROW_H, ...(top !== null ? { top } : {}) }}
    >
      <div
        role="rowheader"
        onMouseDown={(e) => {
          e.preventDefault();
          setAnchor(e.shiftKey ? anchor : { row: r, col: 0 });
          setActive({ row: r, col: cols - 1 });
          grid.current?.focus();
        }}
        className={cn(
          "sticky left-0 z-10 shrink-0 cursor-pointer border-r border-b border-border bg-surface-2 text-center font-mono text-[11.5px] leading-[28px] text-muted select-none",
          r >= range.top && r <= range.bottom && "bg-accent-soft text-accent",
        )}
        style={{ width: HEAD_W }}
      >
        {r + 1}
      </div>
      {widths.map((w, c) => {
        const isActive = r === active.row && c === active.col;
        if (isActive && draft !== null) {
          return (
            <input
              key={c}
              ref={editor}
              aria-label={`Edit ${cellName(r, c)}`}
              value={draft}
              maxLength={MAX_CELL_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitDraft()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDraft(() => step(e.shiftKey ? -1 : 1, 0, false));
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  commitDraft(() => step(0, e.shiftKey ? -1 : 1, false));
                } else if (e.key === "Escape") {
                  setDraft(null);
                  grid.current?.focus();
                }
              }}
              className="z-10 shrink-0 border-2 border-accent bg-surface px-1.5 font-mono text-[13px] text-text outline-none"
              style={{ width: w, height: ROW_H }}
            />
          );
        }
        const v = evaluator.value(r, c);
        const f = fmt(r, c);
        const error = typeof v === "string" && /^#(ERROR|REF|DIV\/0|CYCLE)$/.test(v);
        const selected = inRect(range, r, c);
        return (
          <div
            key={c}
            role="gridcell"
            aria-selected={selected}
            title={raw(r, c).startsWith("=") ? raw(r, c) : undefined}
            onMouseDown={(e) => selectCell(r, c, e)}
            onMouseEnter={() => dragging.current && setActive({ row: r, col: c })}
            onDoubleClick={() => canEdit && setDraft(raw(r, c))}
            className={cn(
              "relative shrink-0 truncate border-r border-b border-border px-1.5 text-[13px] leading-[27px] select-none",
              error ? "text-danger" : "text-text",
              isActive && "z-[1] outline-2 -outline-offset-2 outline-accent",
            )}
            style={{ width: w, ...formatStyle(f, typeof v === "number") }}
          >
            {selected && !isActive ? <span aria-hidden className="pointer-events-none absolute inset-0 bg-accent/10" /> : null}
            {displayValue(v, f.num)}
          </div>
        );
      })}
    </div>
  );

  const rangeLabel = range.top === range.bottom && range.left === range.right ? cellName(active.row, active.col) : `${cellName(range.top, range.left)}:${cellName(range.bottom, range.right)}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        crumbs={[{ label: workspace.name, href: href() }, { label: "Sheets", href: href("sheets") }]}
        icon={<ModuleIcon type="sheets" tile />}
        title={<EditableTitle module="sheets" item={item} editable={canEdit} />}
        meta={`${rows} rows × ${cols} columns${status === "reconnecting" ? " · reconnecting…" : ""}`}
        actions={
          canEdit ? (
            <>
              <Button variant="ghost" disabled={cols >= SHEET_MAX_COLS} onClick={() => void structural(() => resizeSheet(sb, sheet.id, { cols: cols + 1 }))}>
                <Plus className="size-4" /> Column
              </Button>
              <Button variant="ghost" disabled={rows >= SHEET_MAX_ROWS} onClick={() => void structural(() => resizeSheet(sb, sheet.id, { rows: rows + 50 }))}>
                <Plus className="size-4" /> 50 rows
              </Button>
            </>
          ) : null
        }
      />

      <SheetToolbar
        canEdit={canEdit}
        actions={actions}
        state={{
          bold: Boolean(af.b),
          italic: Boolean(af.i),
          align: af.align ?? null,
          num: af.num ?? "auto",
          color: af.color ?? null,
          fill: af.fill ?? null,
          frozen: frozen > 0,
          filtering: filterOn,
        }}
        extra={{ fill, insertRowBelow: () => actions.insertRow("below"), insertColRight: () => actions.insertCol("right") }}
      />

      {filterOn ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-1.5 text-[12.5px] text-text-2">
          <span>Show rows where</span>
          <Select aria-label="Filter column" value={String(filterCol)} onChange={(e) => setFilterCol(Number(e.target.value))} className="w-24">
            {widths.map((_, c) => (
              <option key={c} value={c}>
                {columnName(c)}
              </option>
            ))}
          </Select>
          <span>contains</span>
          <Input aria-label="Filter text" value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="text…" className="h-7 w-48" autoFocus />
          <span className="text-muted">
            {filterText.trim() ? `${bodyRows.length} matching row${bodyRows.length === 1 ? "" : "s"} · only you see this filter` : "Only you see this filter"}
          </span>
          <button type="button" aria-label="Close filter" onClick={() => setFilterOn(false)} className="ml-auto rounded-md p-1 hover:bg-surface hover:text-text">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {/* Formula bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-1.5">
        <span className="min-w-14 rounded-md bg-surface-2 px-2 py-1 text-center font-mono text-[12px] text-text-2">{rangeLabel}</span>
        <span aria-hidden className="font-mono text-[13px] text-muted italic">fx</span>
        <input
          aria-label={`Contents of ${cellName(active.row, active.col)}`}
          value={draft ?? raw(active.row, active.col)}
          readOnly={!canEdit}
          maxLength={MAX_CELL_LENGTH}
          onFocus={() => {
            if (canEdit && draft === null) {
              setAnchor(active);
              setDraft(raw(active.row, active.col));
            }
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft(() => step(1, 0, false));
            } else if (e.key === "Escape") {
              setDraft(null);
              grid.current?.focus();
            }
          }}
          placeholder={canEdit ? "Type a value or a formula like =SUM(A1:A5)" : ""}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none"
        />
      </div>

      <div ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="relative min-h-0 flex-1 overflow-auto bg-surface">
        <div
          ref={grid}
          role="grid"
          aria-label={`${sheet.title} cells`}
          aria-rowcount={rows + 1}
          aria-colcount={cols}
          aria-multiselectable
          tabIndex={0}
          onKeyDown={onGridKey}
          onCopy={(e) => copyRange(e, false)}
          onCut={(e) => copyRange(e, true)}
          onPaste={(e) => void paste(e)}
          className="relative outline-none"
          style={{ width: HEAD_W + totalW, height: headerH + bodyRows.length * ROW_H }}
        >
          {/* Column headers and frozen rows stay on top while scrolling. */}
          <div className="sticky top-0 z-20 bg-surface shadow-[0_1px_0_var(--border)]">
            <div className="flex" style={{ height: ROW_H }} role="row" aria-rowindex={1}>
              <div
                role="columnheader"
                aria-label="Select all"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setAnchor({ row: 0, col: 0 });
                  setActive({ row: rows - 1, col: cols - 1 });
                  grid.current?.focus();
                }}
                className="sticky left-0 z-30 shrink-0 cursor-pointer border-r border-b border-border bg-surface-2"
                style={{ width: HEAD_W }}
              />
              {widths.map((w, c) => (
                <div
                  key={c}
                  role="columnheader"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setAnchor(e.shiftKey ? anchor : { row: 0, col: c });
                    setActive({ row: rows - 1, col: c });
                    grid.current?.focus();
                  }}
                  className={cn(
                    "relative shrink-0 cursor-pointer border-r border-b border-border bg-surface-2 text-center font-mono text-[11.5px] leading-[28px] text-muted select-none",
                    c >= range.left && c <= range.right && "bg-accent-soft text-accent",
                  )}
                  style={{ width: w }}
                >
                  {columnName(c)}
                  {canEdit ? (
                    <span
                      aria-hidden
                      onPointerDown={(e) => startResize(c, e)}
                      className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-accent/40"
                    />
                  ) : null}
                </div>
              ))}
            </div>
            {Array.from({ length: frozen }, (_, r) => renderRow(r, null))}
          </div>

          {Array.from({ length: Math.max(last - first + 1, 0) }, (_, i) => first + i).map((idx) => renderRow(bodyRows[idx]!, headerH + idx * ROW_H))}
        </div>
      </div>

      <p className="shrink-0 border-t border-border bg-surface-2/60 px-4 py-1.5 text-[11.5px] text-muted">
        {canEdit
          ? "Type to edit · Shift+arrows or drag to select · Ctrl+C / X / V copy, cut, paste (works with Excel and Google Sheets) · Ctrl+D fill down · Ctrl+B bold · Delete clears"
          : "View only · you can select, copy, filter and export"}
      </p>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await confirm?.run();
        }}
      />
    </div>
  );
}
