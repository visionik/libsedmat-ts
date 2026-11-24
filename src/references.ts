/**
 * SEDMAT v3.6 reference parsers:
 * - Unified Table Brace Syntax (`{T=...}`) and legacy pipe syntax (`|N|[...]`)
 * - Image Brace Syntax (`{img=...}`) and legacy image syntax (`!(...)`)
 * - URI / Bookmark / `chip://` Smart Chip parser (`{u=...}`)
 */

import {
  ChipKind,
  ImageSpec,
  TableCellCoord,
  TableSpec,
  TableTargetIndex,
  UriTarget,
} from "./types.js";

const CHIP_KINDS = new Set<ChipKind>([
  "person",
  "date",
  "file",
  "place",
  "dropdown",
  "chart",
  "bookmark",
]);

/** Convert Excel column letters ("A" -> 1, "Z" -> 26, "AA" -> 27). */
export function excelColToIndex(letters: string): number {
  let n = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const code = upper.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n;
}

/** Parse a single cell coordinate (`A1`, `B12`, `1,2`, `1,*`, `*,2`, `*,*`). */
export function parseCellCoord(raw: string): TableCellCoord | null {
  const s = raw.trim();
  const excel = /^([A-Za-z]+)(\d+)$/.exec(s);
  if (excel) {
    const col = excelColToIndex(excel[1]!);
    const row = Number.parseInt(excel[2]!, 10);
    if (col >= 1 && row >= 1) return { row, col };
    return null;
  }

  const rc = /^(\*|\d+),(\*|\d+)$/.exec(s);
  if (rc) {
    const row: number | "*" = rc[1] === "*" ? "*" : Number.parseInt(rc[1]!, 10);
    const col: number | "*" = rc[2] === "*" ? "*" : Number.parseInt(rc[2]!, 10);
    if ((row === "*" || row >= 1) && (col === "*" || col >= 1)) {
      return { row, col };
    }
  }
  return null;
}

function parseTableIndex(raw: string): TableTargetIndex | null {
  const s = raw.trim();
  if (s === "*") return "*";
  if (/^-?\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    if (n !== 0) return n;
  }
  return null;
}

/**
 * Parse the value of a `{T=<spec>}` flag:
 * - Creation: `3x4`, `3x4:header`
 * - Reference: `1`, `-1`, `*`
 * - Cell / wildcard: `1!A1`, `1!1,2`, `1!1,*`, `1!*,2`, `1!*`
 * - Range: `1!A1:C3`, `1!1,1:3,3`
 * - Row/Col ops: `1!row=+2`, `1!row=$+`, `1!row=-1`, `1!col=+2`, `1!col=$+`, `1!col=-1`
 */
export function parseTableSpec(raw: string): TableSpec | null {
  const s = raw.trim();
  if (!s) return null;

  // 1. Creation: RxC[:header]
  const createMatch = /^(\d+)x(\d+)(:header)?$/i.exec(s);
  if (createMatch) {
    const rows = Number.parseInt(createMatch[1]!, 10);
    const cols = Number.parseInt(createMatch[2]!, 10);
    if (rows >= 1 && cols >= 1) {
      return {
        kind: "create",
        rows,
        cols,
        header: Boolean(createMatch[3]),
      };
    }
    return null;
  }

  // 2. Reference with optional `!cell-spec`
  const bangIdx = s.indexOf("!");
  if (bangIdx === -1) {
    const table = parseTableIndex(s);
    if (table === null) return null;
    return { kind: "ref", table };
  }

  const table = parseTableIndex(s.slice(0, bangIdx));
  if (table === null) return null;
  const spec = s.slice(bangIdx + 1).trim();
  if (!spec) return null;

  if (spec === "*") {
    return { kind: "allCells", table };
  }

  // Row / column operations
  const rcOp = /^(row|col)=(.+)$/i.exec(spec);
  if (rcOp) {
    const axis = rcOp[1]!.toLowerCase();
    const rhs = rcOp[2]!.trim();
    const kind = axis === "row" ? "rowOp" : "colOp";
    if (rhs === "$+") {
      return { kind, table, op: "append" };
    }
    if (rhs.startsWith("+")) {
      const idx = Number.parseInt(rhs.slice(1), 10);
      if (Number.isFinite(idx) && idx >= 1) {
        return { kind, table, op: "insertBefore", index: idx };
      }
      return null;
    }
    if (/^-?\d+$/.test(rhs)) {
      const idx = Number.parseInt(rhs, 10);
      if (idx !== 0) {
        return { kind, table, op: "delete", index: idx };
      }
    }
    return null;
  }

  // Rectangular range: A1:C3 or 1,1:3,3
  const colonIdx = spec.indexOf(":");
  if (colonIdx !== -1) {
    const from = parseCellCoord(spec.slice(0, colonIdx));
    const to = parseCellCoord(spec.slice(colonIdx + 1));
    if (
      from &&
      to &&
      from.row !== "*" &&
      from.col !== "*" &&
      to.row !== "*" &&
      to.col !== "*"
    ) {
      return {
        kind: "range",
        table,
        from: { row: from.row, col: from.col },
        to: { row: to.row, col: to.col },
      };
    }
    return null;
  }

  // Single cell or row/col wildcard
  const cell = parseCellCoord(spec);
  if (cell) {
    return { kind: "cell", table, cell };
  }

  return null;
}

/**
 * Detect if a `s/pattern/.../` pattern targets a table, supporting both
 * canonical `{T=...}` and legacy `|N|[...]` forms.
 */
export function parseTablePattern(pattern: string): TableSpec | null {
  const trimmed = pattern.trim();

  // Canonical `{T=...}`
  const braceMatch = /^\{T=([^}]+)\}$/.exec(trimmed);
  if (braceMatch) {
    return parseTableSpec(braceMatch[1]!);
  }

  // Legacy `|N|` or `|N|[spec]`
  const legacyMatch = /^\|(\*|-?\d+)\|(?:(\[[^\]]+\]))?$/.exec(trimmed);
  if (legacyMatch) {
    const table = parseTableIndex(legacyMatch[1]!);
    if (table === null) return null;
    if (!legacyMatch[2]) return { kind: "ref", table };
    const inner = legacyMatch[2].slice(1, -1).trim();
    if (inner === "*,*" || inner === "*") return { kind: "allCells", table };
    if (inner === "+1,0") return { kind: "rowOp", table, op: "append" };
    if (inner === "0,+1") return { kind: "colOp", table, op: "append" };
    // Convert legacy `[row:+2]` / `[row:$+]` / `[1,1:1,3]` / `[1,2]`
    if (inner.startsWith("row:") || inner.startsWith("col:")) {
      return parseTableSpec(`${table}!${inner.replace(":", "=")}`);
    }
    return parseTableSpec(`${table}!${inner}`);
  }

  return null;
}

/**
 * Parse the value of `{img=<spec>}`:
 * - `*` -> all images
 * - integer (`1`, `-1`) -> positional image index
 * - `https://...` / `http://...` / `data:...` -> URL insert
 * - anything else -> alt-text regex
 */
export function parseImageSpec(raw: string): ImageSpec | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === "*") return { kind: "all" };
  if (/^-?\d+$/.test(s)) {
    const index = Number.parseInt(s, 10);
    if (index !== 0) return { kind: "index", index };
  }
  if (/^(?:https?:|data:|file:)/i.test(s)) {
    return { kind: "url", url: s };
  }
  return { kind: "regex", pattern: s };
}

/**
 * Detect if a `s/pattern/.../` pattern targets an image (`{img=...}` or legacy `!(1)` / `![alt]`).
 */
export function parseImagePattern(pattern: string): ImageSpec | null {
  const trimmed = pattern.trim();
  const brace = /^\{img=([^}]+)\}$/.exec(trimmed);
  if (brace) return parseImageSpec(brace[1]!);

  const legacyIdx = /^!\((\*|-?\d+)\)$/.exec(trimmed);
  if (legacyIdx) return parseImageSpec(legacyIdx[1]!);

  const legacyAlt = /^!\[([^\]]+)\]$/.exec(trimmed);
  if (legacyAlt) return { kind: "regex", pattern: legacyAlt[1]! };

  return null;
}

/**
 * Parse a `{u=...}` value into a structured `UriTarget` (standard URL, `#bookmark`, or `chip://...`).
 */
export function parseUriTarget(raw: string): UriTarget {
  const trimmed = raw.trim();
  if (trimmed.startsWith("#") && trimmed.length > 1) {
    return { kind: "bookmark", name: trimmed.slice(1) };
  }
  const chipMatch = /^chip:\/\/([a-z]+)\/(.+)$/i.exec(trimmed);
  if (chipMatch) {
    const kind = chipMatch[1]!.toLowerCase() as ChipKind;
    if (CHIP_KINDS.has(kind)) {
      return {
        kind: "chip",
        chip: {
          kind,
          value: chipMatch[2]!,
          raw: trimmed,
        },
      };
    }
  }
  return { kind: "url", href: trimmed };
}
