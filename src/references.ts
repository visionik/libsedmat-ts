import type { CellReference, ImageReference, ImageSpec, TableCreateSpec, TableReference } from "./types.ts";
import { findMatchingBrace } from "./brace.ts";

export function parseExcelReference(value: string): { row: number; col: number } | undefined {
  const m = /^([A-Za-z]+)(\d+)$/.exec(value.trim());
  if (!m) return undefined;
  const letters = m[1]!.toUpperCase();
  const row = Number.parseInt(m[2]!, 10);
  if (row < 1) return undefined;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col >= 1 ? { row, col } : undefined;
}

export function parseTableReference(value: string): TableReference | undefined {
  const m = /^\|(-?\d+)\|$/.exec(value.trim());
  if (!m) return undefined;
  const idx = Number.parseInt(m[1]!, 10);
  if (idx === 0) return undefined;
  return { tableIndex: idx };
}

export function parseTableCellReference(value: string): CellReference | undefined {
  const m = /^\|(-?\d+)\|\[([^\]]+)\](.*)$/.exec(value);
  if (!m) return undefined;
  const tableIndex = Number.parseInt(m[1]!, 10);
  if (tableIndex === 0) return undefined;
  const cellValue = m[2]!;
  let after = m[3] ?? "";
  if (after.startsWith(":")) {
    after = after.slice(1);
  }
  const subpattern = after || undefined;

  // Axis ops: row:+2, col:-1, row:$+
  if (cellValue.startsWith("row:") || cellValue.startsWith("col:")) {
    const isRow = cellValue.startsWith("row:");
    const rest = cellValue.slice(4);
    const ref: CellReference = { tableIndex, row: 0, column: 0 };
    if (rest === "$+") {
      if (isRow) ref.rowOperation = "append";
      else ref.columnOperation = "append";
      return ref;
    }
    if (rest.startsWith("+")) {
      const n = Number.parseInt(rest.slice(1), 10);
      if (!Number.isNaN(n)) {
        if (isRow) ref.rowOperation = "insert";
        else ref.columnOperation = "insert";
        ref.operationTarget = n;
        return ref;
      }
    }
    const n = Number.parseInt(rest, 10);
    if (!Number.isNaN(n)) {
      if (isRow) ref.rowOperation = "delete";
      else ref.columnOperation = "delete";
      ref.operationTarget = n;
      return ref;
    }
    return undefined;
  }

  // Range 1,1:2,3
  if (cellValue.includes(":")) {
    const [startStr, endStr] = cellValue.split(":", 2);
    const s = parseNumericPair(startStr!);
    const e = parseNumericPair(endStr!);
    if (!s || !e) return undefined;
    return { tableIndex, row: s.row, column: s.col, endRow: e.row, endColumn: e.col, subpattern };
  }

  // Excel ref A1
  const excel = parseExcelReference(cellValue);
  if (excel) {
    return { tableIndex, row: excel.row, column: excel.col, subpattern };
  }

  // Numeric pair R,C or wildcards *,C / R,*
  if (cellValue.includes(",")) {
    const [rStr, cStr] = cellValue.split(",", 2);
    if (rStr === "*") {
      const col = Number.parseInt(cStr!, 10);
      if (col >= 1) return { tableIndex, row: 0, column: col, subpattern };
      return undefined;
    }
    if (cStr === "*") {
      const row = Number.parseInt(rStr!, 10);
      if (row >= 1) return { tableIndex, row, column: 0, subpattern };
      return undefined;
    }
    const pair = parseNumericPair(cellValue);
    if (pair) {
      return { tableIndex, row: pair.row, column: pair.col, subpattern };
    }
  }

  return undefined;
}

function parseNumericPair(s: string): { row: number; col: number } | undefined {
  const m = /^(\d+),(\d+)$/.exec(s.trim());
  if (!m) return undefined;
  const row = Number.parseInt(m[1]!, 10);
  const col = Number.parseInt(m[2]!, 10);
  if (row < 1 || col < 1) return undefined;
  return { row, col };
}

export function parseBraceTableReference(spec: string): TableReference {
  const s = spec.trim();
  const createMatch = /^(\d+)x(\d+)(:header)?$/i.exec(s);
  if (createMatch) {
    return {
      tableIndex: 0,
      isCreate: true,
      createRows: Number.parseInt(createMatch[1]!, 10),
      createCols: Number.parseInt(createMatch[2]!, 10),
      hasHeader: Boolean(createMatch[3]),
    };
  }
  if (s === "*") {
    return { tableIndex: 0, isAllCells: true };
  }
  const bangIdx = s.indexOf("!");
  if (bangIdx < 0) {
    const idx = Number.parseInt(s, 10);
    if (Number.isNaN(idx) || idx === 0) throw new Error(`invalid table reference: ${spec}`);
    return { tableIndex: idx };
  }
  const idx = Number.parseInt(s.slice(0, bangIdx), 10);
  if (Number.isNaN(idx) || idx === 0) throw new Error(`invalid table index: ${spec}`);
  const cellPart = s.slice(bangIdx + 1);
  const ref: TableReference = { tableIndex: idx };
  if (cellPart === "*") {
    ref.isAllCells = true;
    return ref;
  }
  if (cellPart.startsWith("row=")) {
    ref.rowOp = cellPart.slice(4);
    return ref;
  }
  if (cellPart.startsWith("col=")) {
    ref.colOp = cellPart.slice(4);
    return ref;
  }
  if (cellPart.includes(":")) {
    const [a, b] = cellPart.split(":", 2);
    const start = parseExcelReference(a!) ?? parseNumericPair(a!);
    const end = parseExcelReference(b!) ?? parseNumericPair(b!);
    if (!start || !end) throw new Error(`invalid table range: ${spec}`);
    ref.row = start.row;
    ref.col = start.col;
    ref.hasRange = true;
    ref.endRow = end.row;
    ref.endCol = end.col;
    return ref;
  }
  const coord = parseExcelReference(cellPart) ?? parseNumericPair(cellPart);
  if (coord) {
    ref.row = coord.row;
    ref.col = coord.col;
    return ref;
  }
  if (cellPart.includes(",")) {
    const [r, c] = cellPart.split(",", 2);
    if (r === "*") {
      ref.rowWild = true;
      ref.col = Number.parseInt(c!, 10);
      return ref;
    }
    if (c === "*") {
      ref.colWild = true;
      ref.row = Number.parseInt(r!, 10);
      return ref;
    }
  }
  throw new Error(`invalid table cell spec: ${spec}`);
}

export function parseBraceImageReference(spec: string): ImageReference {
  const s = spec.trim();
  if (s === "*") return { allImages: true };
  if (/^-?\d+$/.test(s)) {
    const pos = Number.parseInt(s, 10);
    if (pos === 0) throw new Error("image position cannot be 0");
    return { byPosition: true, position: pos };
  }
  return { byAlt: true, pattern: s };
}

export function detectBraceReference(pattern: string): {
  remaining: string;
  table?: TableReference;
  image?: ImageReference;
} {
  if (!pattern.startsWith("{")) return { remaining: pattern };
  const closeIdx = findMatchingBrace(pattern, 0);
  if (closeIdx < 0) return { remaining: pattern };
  const inner = pattern.slice(1, closeIdx).trim();
  const remaining = pattern.slice(closeIdx + 1);
  if (inner.startsWith("T=")) {
    return { remaining, table: parseBraceTableReference(inner.slice(2)) };
  }
  if (inner.startsWith("img=")) {
    return { remaining, image: parseBraceImageReference(inner.slice(4)) };
  }
  return { remaining: pattern };
}

export function parseImageReference(pattern: string): ImageReference | undefined {
  const posMatch = /^!\((-?\d+|\*)\)$/.exec(pattern.trim());
  if (posMatch) {
    if (posMatch[1] === "*") return { allImages: true };
    const pos = Number.parseInt(posMatch[1]!, 10);
    if (pos === 0) return undefined;
    return { byPosition: true, position: pos };
  }
  const altMatch = /^!\[(.+)\]$/.exec(pattern.trim());
  if (altMatch) {
    return { byAlt: true, pattern: altMatch[1]! };
  }
  return undefined;
}

export function parseImageSyntax(input: string): ImageSpec | undefined {
  const m = /^!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]*)\})?$/.exec(input.trim());
  if (!m) return undefined;
  const spec: ImageSpec = { alt: m[1] || undefined, url: m[2]! };
  if (m[3]) {
    const w = /(?:width|x)=(\d+(?:\.\d+)?)/.exec(m[3]);
    const h = /(?:height|y)=(\d+(?:\.\d+)?)/.exec(m[3]);
    if (w) spec.width = Number.parseFloat(w[1]!);
    if (h) spec.height = Number.parseFloat(h[1]!);
  }
  return spec;
}

export function parseTableCreate(value: string): TableCreateSpec | undefined {
  const m = /^\|(\d+)x(\d+)(:header)?\|$/i.exec(value.trim());
  if (!m) return undefined;
  const rows = Number.parseInt(m[1]!, 10);
  const columns = Number.parseInt(m[2]!, 10);
  if (rows < 1 || columns < 1) return undefined;
  return { rows, columns, header: Boolean(m[3]) };
}

export function parsePipeTable(value: string): TableCreateSpec | undefined {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (!normalized.includes("|") || !normalized.includes("\n")) return undefined;
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return undefined;
  if (!lines.every((l) => l.startsWith("|") && l.endsWith("|"))) return undefined;

  const cells: string[][] = [];
  let header = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const rawCells = line.slice(1, -1).split("|").map((c) => c.trim());
    if (rawCells.every((c) => /^:?-+:?$/.test(c))) {
      if (i === 1) header = true;
      continue;
    }
    cells.push(rawCells);
  }
  if (cells.length === 0) return undefined;
  const cols = Math.max(...cells.map((r) => r.length));
  if (cols < 1) return undefined;
  return { rows: cells.length, columns: cols, header, cells };
}
