import { describe, expect, it } from "vitest";
import { SheetEvaluator, cellName, columnIndex, columnName, formatCellValue, parseCellName } from "../src/sheet";

function grid(cells: Record<string, string>) {
  return new SheetEvaluator((row, col) => cells[cellName(row, col)] ?? "");
}
const show = (cells: Record<string, string>, ref: string) => {
  const p = parseCellName(ref)!;
  return formatCellValue(grid(cells).value(p.row, p.col));
};

describe("addresses", () => {
  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 51].map(columnName)).toEqual(["A", "Z", "AA", "AZ"]);
    expect(columnIndex("AZ")).toBe(51);
    expect(parseCellName("$B$3")).toEqual({ row: 2, col: 1 });
    expect(parseCellName("A1001")).toBeNull();
    expect(parseCellName("BA1")).toBeNull(); // past the 52-column limit
  });
});

describe("formulas", () => {
  const data = { A1: "10", A2: "20", A3: "30", B1: "Rent", B2: "=A1*2", C1: "=SUM(A1:A3)" };

  it("does arithmetic with precedence, brackets and references", () => {
    expect(show({ A1: "=1+2*3" }, "A1")).toBe("7");
    expect(show({ A1: "=(1+2)*3" }, "A1")).toBe("9");
    expect(show({ A1: "=2^3^2" }, "A1")).toBe("512");
    expect(show({ A1: "=-A2+1", A2: "5" }, "A1")).toBe("-4");
    expect(show(data, "B2")).toBe("20");
    expect(show({ A1: "=0.1+0.2" }, "A1")).toBe("0.3");
  });

  it("supports functions over ranges", () => {
    expect(show(data, "C1")).toBe("60");
    expect(show({ ...data, D1: "=AVERAGE(A1:A3)" }, "D1")).toBe("20");
    expect(show({ ...data, D1: "=MIN(A1:A3)" }, "D1")).toBe("10");
    expect(show({ ...data, D1: "=MAX(A1:A3, 99)" }, "D1")).toBe("99");
    expect(show({ ...data, D1: "=COUNT(A1:B3)" }, "D1")).toBe("4"); // B2 is a number formula; text is skipped
    expect(show({ D1: "=ROUND(3.14159, 2)" }, "D1")).toBe("3.14");
    expect(show({ D1: "=IF(A1>5, \"big\", \"small\")", A1: "7" }, "D1")).toBe("big");
    expect(show({ D1: '=B1 & " paid"', B1: "Rent" }, "D1")).toBe("Rent paid");
  });

  it("reports errors instead of throwing", () => {
    expect(show({ A1: "=1/0" }, "A1")).toBe("#DIV/0");
    expect(show({ A1: "=1+" }, "A1")).toBe("#ERROR");
    expect(show({ A1: "=NOPE(1)" }, "A1")).toBe("#ERROR");
    expect(show({ A1: "=ZZ9" }, "A1")).toBe("#REF");
    expect(show({ A1: "=A2", A2: "=A1" }, "A1")).toBe("#CYCLE");
    expect(show({ A1: "=A2+1", A2: "=1/0" }, "A1")).toBe("#DIV/0");
    expect(show({ A1: "=B1*2", B1: "Rent" }, "A1")).toBe("#ERROR");
  });

  it("leaves plain text and numbers alone", () => {
    expect(show({ A1: "hello" }, "A1")).toBe("hello");
    expect(show({ A1: " 42 " }, "A1")).toBe("42");
    expect(show({}, "A1")).toBe("");
  });
});

import { cleanFormat, displayValue, parseDelimited, shiftFormula, toDelimited } from "../src/sheet";

describe("moving formulas", () => {
  it("shifts relative references and keeps $-anchored ones", () => {
    expect(shiftFormula("=A1+B2", 1, 0)).toBe("=A2+B3");
    expect(shiftFormula("=SUM(A1:A3)", 0, 2)).toBe("=SUM(C1:C3)");
    expect(shiftFormula("=$A$1+A1", 3, 3)).toBe("=$A$1+D4");
    expect(shiftFormula("=$A1+B$1", 2, 2)).toBe("=$A3+D$1");
    expect(shiftFormula('="A1 "&A1', 1, 0)).toBe('="A1 "&A2');
    expect(shiftFormula("=A1", -1, 0)).toBe("=#REF");
    expect(shiftFormula("plain A1", 1, 1)).toBe("plain A1");
  });
});

describe("formats", () => {
  it("cleans formats from other clients", () => {
    expect(cleanFormat({ b: true, color: "#ff0000", fill: "red; background:url(x)", align: "middle", num: "currency", extra: 1 })).toEqual({
      b: true,
      color: "#ff0000",
      num: "currency",
    });
    expect(cleanFormat(null)).toEqual({});
  });

  it("shows numbers by format", () => {
    expect(displayValue(1234.5, "number", "en-US")).toBe("1,234.50");
    expect(displayValue(1234.5, "currency", "en-US")).toBe("$1,234.50");
    expect(displayValue(0.256, "percent", "en-US")).toBe("25.6%");
    expect(displayValue(45000, "date", "en-US")).toBe("3/15/2023");
    expect(displayValue("text", "currency", "en-US")).toBe("text");
  });
});

describe("delimited text", () => {
  it("round-trips CSV with quotes, commas and line breaks", () => {
    const rows = [["Name", "Note"], ["Ada", 'said "hi", then left'], ["Bob", "line1\nline2"]];
    const csv = toDelimited(rows, ",");
    expect(parseDelimited(csv, ",")).toEqual(rows);
  });

  it("reads clipboard TSV from Excel or Google Sheets", () => {
    expect(parseDelimited("1\t2\r\n3\t4\r\n", "\t")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});
