import { describe, expect, it } from "vitest";
import {
  excelColToIndex,
  parseImagePattern,
  parseImageSpec,
  parseTablePattern,
  parseTableSpec,
  parseUriTarget,
} from "../src/index.js";

describe("SEDMAT v3.6 Table, Image, and URI references", () => {
  it("converts Excel columns cleanly", () => {
    expect(excelColToIndex("A")).toBe(1);
    expect(excelColToIndex("Z")).toBe(26);
    expect(excelColToIndex("AA")).toBe(27);
  });

  it("parses canonical {T=...} table specs", () => {
    expect(parseTableSpec("3x4")).toEqual({ kind: "create", rows: 3, cols: 4, header: false });
    expect(parseTableSpec("3x4:header")).toEqual({
      kind: "create",
      rows: 3,
      cols: 4,
      header: true,
    });
    expect(parseTableSpec("1")).toEqual({ kind: "ref", table: 1 });
    expect(parseTableSpec("-1")).toEqual({ kind: "ref", table: -1 });
    expect(parseTableSpec("*")).toEqual({ kind: "ref", table: "*" });

    expect(parseTableSpec("1!A1")).toEqual({
      kind: "cell",
      table: 1,
      cell: { row: 1, col: 1 },
    });
    expect(parseTableSpec("1!2,3")).toEqual({
      kind: "cell",
      table: 1,
      cell: { row: 2, col: 3 },
    });
    expect(parseTableSpec("1!1,*")).toEqual({
      kind: "cell",
      table: 1,
      cell: { row: 1, col: "*" },
    });
    expect(parseTableSpec("1!*,2")).toEqual({
      kind: "cell",
      table: 1,
      cell: { row: "*", col: 2 },
    });
    expect(parseTableSpec("1!*")).toEqual({ kind: "allCells", table: 1 });

    expect(parseTableSpec("1!A1:C3")).toEqual({
      kind: "range",
      table: 1,
      from: { row: 1, col: 1 },
      to: { row: 3, col: 3 },
    });
    expect(parseTableSpec("1!row=+2")).toEqual({
      kind: "rowOp",
      table: 1,
      op: "insertBefore",
      index: 2,
    });
    expect(parseTableSpec("1!row=$+")).toEqual({ kind: "rowOp", table: 1, op: "append" });
    expect(parseTableSpec("1!row=-1")).toEqual({
      kind: "rowOp",
      table: 1,
      op: "delete",
      index: -1,
    });
    expect(parseTableSpec("1!col=$+")).toEqual({ kind: "colOp", table: 1, op: "append" });
  });

  it("parses both canonical {T=...} and legacy |N|[...] table patterns", () => {
    expect(parseTablePattern("{T=1!B2}")).toEqual({
      kind: "cell",
      table: 1,
      cell: { row: 2, col: 2 },
    });
    expect(parseTablePattern("|1|[1,1]")).toEqual({
      kind: "cell",
      table: 1,
      cell: { row: 1, col: 1 },
    });
    expect(parseTablePattern("|1|[+1,0]")).toEqual({ kind: "rowOp", table: 1, op: "append" });
    expect(parseTablePattern("|-1|")).toEqual({ kind: "ref", table: -1 });
  });

  it("parses canonical {img=...} and legacy image patterns", () => {
    expect(parseImageSpec("1")).toEqual({ kind: "index", index: 1 });
    expect(parseImageSpec("-1")).toEqual({ kind: "index", index: -1 });
    expect(parseImageSpec("*")).toEqual({ kind: "all" });
    expect(parseImageSpec("https://example.com/a.png")).toEqual({
      kind: "url",
      url: "https://example.com/a.png",
    });
    expect(parseImageSpec("logo.*")).toEqual({ kind: "regex", pattern: "logo.*" });

    expect(parseImagePattern("{img=-1}")).toEqual({ kind: "index", index: -1 });
    expect(parseImagePattern("!(1)")).toEqual({ kind: "index", index: 1 });
    expect(parseImagePattern("![logo]")).toEqual({ kind: "regex", pattern: "logo" });
  });

  it("parses standard URLs, #bookmarks, and chip:// URIs", () => {
    expect(parseUriTarget("https://sedmat.org")).toEqual({
      kind: "url",
      href: "https://sedmat.org",
    });
    expect(parseUriTarget("#sec-2")).toEqual({ kind: "bookmark", name: "sec-2" });
    expect(parseUriTarget("chip://date/2026-11-23")).toEqual({
      kind: "chip",
      chip: { kind: "date", value: "2026-11-23", raw: "chip://date/2026-11-23" },
    });
    expect(parseUriTarget("chip://chart/SHEET_ID/0")).toEqual({
      kind: "chip",
      chip: { kind: "chart", value: "SHEET_ID/0", raw: "chip://chart/SHEET_ID/0" },
    });
  });
});
