/**
 * Sheets: cell addressing and a small, safe formula engine (no eval).
 *
 * A cell holding text that starts with "=" is a formula. Supported:
 *   numbers, cell references (A1, $B$2), ranges inside functions (A1:B5),
 *   + - * / ^, unary minus, parentheses, comparisons (= <> < <= > >=),
 *   text in double quotes, & to join text, and the functions
 *   SUM AVERAGE (AVG) MIN MAX COUNT ROUND ABS IF.
 * Errors show as #ERROR (bad formula), #REF (outside the grid), #DIV/0 and
 * #CYCLE (a formula that depends on itself).
 */

export const SHEET_MAX_ROWS = 1000;
export const SHEET_MAX_COLS = 52;

/** 0 → "A", 25 → "Z", 26 → "AA" … */
export function columnName(col: number): string {
  let n = col + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellName(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function parseCellName(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,2})\$?(\d{1,4})$/.exec(ref.trim());
  if (!m) return null;
  const row = Number(m[2]) - 1;
  const col = columnIndex(m[1]!);
  if (row < 0 || row >= SHEET_MAX_ROWS || col < 0 || col >= SHEET_MAX_COLS) return null;
  return { row, col };
}

export type CellValue = number | string | boolean;
export type SheetError = "#ERROR" | "#REF" | "#DIV/0" | "#CYCLE";

class FormulaError extends Error {
  constructor(readonly code: SheetError) {
    super(code);
  }
}

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "fn"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v: "(" }
  | { t: ")"; v: ")" }
  | { t: ","; v: "," }
  | { t: ":"; v: ":" };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError("#ERROR");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError("#ERROR");
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z$]/.test(c)) {
      const m = /^\$?[A-Za-z]+\$?\d*/.exec(src.slice(i))!;
      const word = m[0];
      i += word.length;
      if (/\d$/.test(word)) out.push({ t: "ref", v: word.replace(/\$/g, "").toUpperCase() });
      else if (src[i] === "(") out.push({ t: "fn", v: word.toUpperCase() });
      else if (/^(TRUE|FALSE)$/i.test(word)) out.push({ t: "num", v: /^true$/i.test(word) ? 1 : 0 });
      else throw new FormulaError("#ERROR");
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>".includes(c)) out.push({ t: "op", v: c });
    else if (c === "(" || c === ")" || c === "," || c === ":") out.push({ t: c, v: c } as Token);
    else throw new FormulaError("#ERROR");
    i++;
  }
  return out;
}

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "ref"; ref: string }
  | { k: "range"; from: string; to: string }
  | { k: "neg"; e: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const PRECEDENCE: Record<string, number> = { "=": 1, "<>": 1, "<": 1, "<=": 1, ">": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];

  function primary(): Node {
    const tok = take();
    if (!tok) throw new FormulaError("#ERROR");
    switch (tok.t) {
      case "num":
        return { k: "num", v: tok.v };
      case "str":
        return { k: "str", v: tok.v };
      case "ref": {
        if (peek()?.t === ":") {
          take();
          const end = take();
          if (end?.t !== "ref") throw new FormulaError("#ERROR");
          return { k: "range", from: tok.v, to: end.v };
        }
        return { k: "ref", ref: tok.v };
      }
      case "fn": {
        take(); // (
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            args.push(expr(0));
            if (peek()?.t === ",") take();
            else break;
          }
        }
        if (take()?.t !== ")") throw new FormulaError("#ERROR");
        return { k: "call", fn: tok.v, args };
      }
      case "(": {
        const e = expr(0);
        if (take()?.t !== ")") throw new FormulaError("#ERROR");
        return e;
      }
      case "op":
        if (tok.v === "-") return { k: "neg", e: expr(PRECEDENCE["^"]!) };
        if (tok.v === "+") return expr(PRECEDENCE["^"]!);
        throw new FormulaError("#ERROR");
      default:
        throw new FormulaError("#ERROR");
    }
  }

  function expr(min: number): Node {
    let left = primary();
    for (;;) {
      const tok = peek();
      if (tok?.t !== "op") break;
      const prec = PRECEDENCE[tok.v]!;
      if (prec < min) break;
      take();
      // ^ is right-associative; the rest are left-associative.
      const right = expr(tok.v === "^" ? prec : prec + 1);
      left = { k: "bin", op: tok.v, a: left, b: right };
    }
    return left;
  }

  const tree = expr(0);
  if (pos !== tokens.length) throw new FormulaError("#ERROR");
  return tree;
}

/** Raw cell text by position. */
export type CellLookup = (row: number, col: number) => string;

function toNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v.trim() === "") return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new FormulaError("#ERROR");
  return n;
}

/** Evaluates every formula in a grid, memoised, with cycle detection. */
export class SheetEvaluator {
  private cache = new Map<string, CellValue | SheetError>();
  private visiting = new Set<string>();

  constructor(private readonly lookup: CellLookup) {}

  /** Display value of a cell: its text, a number, or an error code. */
  value(row: number, col: number): CellValue | SheetError {
    const key = `${row}:${col}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const raw = this.lookup(row, col);
    if (!raw.startsWith("=")) {
      const trimmed = raw.trim();
      const v: CellValue = trimmed !== "" && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : raw;
      this.cache.set(key, v);
      return v;
    }
    if (this.visiting.has(key)) return "#CYCLE";
    this.visiting.add(key);
    let result: CellValue | SheetError;
    try {
      result = this.evaluate(parse(tokenize(raw.slice(1))));
      if (typeof result === "number" && !Number.isFinite(result)) result = "#DIV/0";
    } catch (err) {
      result = err instanceof FormulaError ? err.code : "#ERROR";
    }
    this.visiting.delete(key);
    this.cache.set(key, result);
    return result;
  }

  private cell(ref: string): CellValue {
    const p = parseCellName(ref);
    if (!p) throw new FormulaError("#REF");
    const v = this.value(p.row, p.col);
    if (typeof v === "string" && v.startsWith("#") && ["#ERROR", "#REF", "#DIV/0", "#CYCLE"].includes(v)) throw new FormulaError(v as SheetError);
    return v;
  }

  private range(from: string, to: string): CellValue[] {
    const a = parseCellName(from);
    const b = parseCellName(to);
    if (!a || !b) throw new FormulaError("#REF");
    const out: CellValue[] = [];
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.push(this.cell(`${columnName(c)}${r + 1}`));
    }
    return out;
  }

  /** Function arguments, with ranges flattened. */
  private values(args: Node[]): CellValue[] {
    return args.flatMap((a) => (a.k === "range" ? this.range(a.from, a.to) : [this.evaluate(a)]));
  }

  private evaluate(n: Node): CellValue {
    switch (n.k) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "ref":
        return this.cell(n.ref);
      case "range":
        throw new FormulaError("#ERROR"); // ranges only make sense inside functions
      case "neg":
        return -toNumber(this.evaluate(n.e));
      case "bin": {
        const a = this.evaluate(n.a);
        const b = this.evaluate(n.b);
        switch (n.op) {
          case "+":
            return toNumber(a) + toNumber(b);
          case "-":
            return toNumber(a) - toNumber(b);
          case "*":
            return toNumber(a) * toNumber(b);
          case "/": {
            const d = toNumber(b);
            if (d === 0) throw new FormulaError("#DIV/0");
            return toNumber(a) / d;
          }
          case "^":
            return toNumber(a) ** toNumber(b);
          case "&":
            return `${a}${b}`;
          default: {
            const cmp = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
            const ok = { "=": cmp === 0, "<>": cmp !== 0, "<": cmp < 0, "<=": cmp <= 0, ">": cmp > 0, ">=": cmp >= 0 }[n.op];
            if (ok === undefined) throw new FormulaError("#ERROR");
            return ok;
          }
        }
      }
      case "call":
        return this.call(n.fn, n.args);
    }
  }

  private call(fn: string, args: Node[]): CellValue {
    const nums = () => this.values(args).filter((v): v is number => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))).map(toNumber);
    switch (fn) {
      case "SUM":
        return nums().reduce((s, x) => s + x, 0);
      case "AVERAGE":
      case "AVG": {
        const xs = nums();
        if (!xs.length) throw new FormulaError("#DIV/0");
        return xs.reduce((s, x) => s + x, 0) / xs.length;
      }
      case "MIN": {
        const xs = nums();
        return xs.length ? Math.min(...xs) : 0;
      }
      case "MAX": {
        const xs = nums();
        return xs.length ? Math.max(...xs) : 0;
      }
      case "COUNT":
        return nums().length;
      case "ABS":
        if (args.length !== 1) throw new FormulaError("#ERROR");
        return Math.abs(toNumber(this.evaluate(args[0]!)));
      case "ROUND": {
        if (args.length < 1 || args.length > 2) throw new FormulaError("#ERROR");
        const digits = args[1] ? toNumber(this.evaluate(args[1])) : 0;
        const f = 10 ** Math.trunc(digits);
        return Math.round(toNumber(this.evaluate(args[0]!)) * f) / f;
      }
      case "IF": {
        if (args.length < 2 || args.length > 3) throw new FormulaError("#ERROR");
        const cond = this.evaluate(args[0]!);
        const truthy = typeof cond === "string" ? cond !== "" : toNumber(cond) !== 0;
        return truthy ? this.evaluate(args[1]!) : args[2] ? this.evaluate(args[2]) : false;
      }
      default:
        throw new FormulaError("#ERROR");
    }
  }
}

/** How a computed value is shown in a cell. */
export function formatCellValue(v: CellValue | SheetError): string {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
  return v;
}

// ---------------------------------------------------------------------------
// Moving formulas, cell formats, and delimited text (CSV / clipboard)
// ---------------------------------------------------------------------------

/**
 * Rewrites a formula's relative references for a copy that lands dRow rows
 * and dCol columns away (as spreadsheets do on paste and fill). `$`-anchored
 * parts stay put; text in quotes is left alone. References pushed off the grid
 * become #REF.
 */
export function shiftFormula(text: string, dRow: number, dCol: number): string {
  if (!text.startsWith("=") || (dRow === 0 && dCol === 0)) return text;
  return text
    .split(/("[^"]*")/)
    .map((part) =>
      part.startsWith('"')
        ? part
        : part.replace(/(\$?)([A-Za-z]{1,2})(\$?)(\d{1,4})(?![A-Za-z0-9(])/g, (_m, colAbs: string, colName: string, rowAbs: string, rowNum: string) => {
            const col = colAbs ? columnIndex(colName) : columnIndex(colName) + dCol;
            const row = rowAbs ? Number(rowNum) - 1 : Number(rowNum) - 1 + dRow;
            if (col < 0 || col >= SHEET_MAX_COLS || row < 0 || row >= SHEET_MAX_ROWS) return "#REF";
            return `${colAbs}${columnName(col)}${rowAbs}${row + 1}`;
          }),
    )
    .join("");
}

export const NUMBER_FORMATS = ["auto", "number", "currency", "percent", "date"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export interface CellFormat {
  b?: boolean;
  i?: boolean;
  /** Text colour, #rrggbb. */
  color?: string;
  /** Fill colour, #rrggbb. */
  fill?: string;
  align?: "left" | "center" | "right";
  num?: NumberFormat;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Keeps only valid keys, so a collaborator can't smuggle odd values into styles. */
export function cleanFormat(input: unknown): CellFormat {
  if (!input || typeof input !== "object") return {};
  const f = input as Record<string, unknown>;
  const out: CellFormat = {};
  if (f.b === true) out.b = true;
  if (f.i === true) out.i = true;
  if (typeof f.color === "string" && HEX.test(f.color)) out.color = f.color;
  if (typeof f.fill === "string" && HEX.test(f.fill)) out.fill = f.fill;
  if (f.align === "left" || f.align === "center" || f.align === "right") out.align = f.align;
  if (typeof f.num === "string" && (NUMBER_FORMATS as readonly string[]).includes(f.num) && f.num !== "auto") out.num = f.num as NumberFormat;
  return out;
}

/** The text shown for a value under a number format. */
export function displayValue(v: CellValue | SheetError, num: NumberFormat | undefined, locale?: string): string {
  if (typeof v === "number" && num && num !== "auto") {
    switch (num) {
      case "number":
        return v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case "currency":
        return v.toLocaleString(locale, { style: "currency", currency: "USD" });
      case "percent":
        return v.toLocaleString(locale, { style: "percent", maximumFractionDigits: 2 });
      case "date": {
        // Spreadsheet serial dates: days since 1899-12-30.
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
        return Number.isNaN(d.getTime()) ? formatCellValue(v) : d.toLocaleDateString(locale, { timeZone: "UTC" });
      }
    }
  }
  return formatCellValue(v);
}

/** Parses CSV or TSV (quoted fields, "" escapes, CRLF) into rows of cells. */
export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Joins rows of cells as CSV or TSV, quoting where needed. */
export function toDelimited(rows: string[][], delimiter: "," | "\t"): string {
  const needs = new RegExp(`["\r\n${delimiter === "\t" ? "\t" : ","}]`);
  return rows.map((r) => r.map((c) => (needs.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(delimiter)).join("\r\n");
}
