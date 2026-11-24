/**
 * Zero-dependency in-memory `SedmatBackend` reference implementation.
 * Useful for standalone CLI dry-runs, conformance tests, and as a blueprint
 * for writing document backends (Word, Google Docs, Markdown, Slides, etc.).
 */

import { MatchReplacement, SedmatBackend } from "./backend.js";
import {
  AddressElement,
  AddressElementKind,
  ImageSpec,
  PositionalPattern,
  SedmatFormatFlags,
  SedmatStyledSpan,
  TableSpec,
} from "./types.js";

export interface MemoryRun {
  text: string;
  flags?: SedmatFormatFlags;
}

export interface MemoryParagraph {
  kind: "paragraph";
  id: string;
  style?: string;
  runs: MemoryRun[];
  flags?: SedmatFormatFlags;
  comments?: string[];
  bookmarks?: string[];
}

export interface MemoryTable {
  kind: "table";
  id: string;
  header: boolean;
  rows: string[][];
}

export interface MemoryToc {
  kind: "toc";
  id: string;
  maxDepth?: number;
}

export type MemoryElement = MemoryParagraph | MemoryTable | MemoryToc;

export class MemorySedmatBackend implements SedmatBackend {
  elements: MemoryElement[];
  images: Array<{ url: string; alt: string; width?: number; height?: number }> = [];
  sectionCols = 1;
  private nextId = 1;

  constructor(initialParagraphs: string[] = []) {
    this.elements = initialParagraphs.map((text) => this.makeParagraph(text));
  }

  private makeParagraph(text: string, flags?: SedmatFormatFlags): MemoryParagraph {
    return {
      kind: "paragraph",
      id: `el_${this.nextId++}`,
      style: flags?.heading ?? "Normal",
      runs: text ? [{ text, flags }] : [],
      flags,
    };
  }

  private makeParagraphFromSpans(spans: SedmatStyledSpan[]): MemoryParagraph {
    const p: MemoryParagraph = {
      kind: "paragraph",
      id: `el_${this.nextId++}`,
      style: "Normal",
      runs: [],
    };
    for (const sp of spans) {
      if (sp.flags?.heading) p.style = sp.flags.heading;
      if (sp.flags?.comment) (p.comments ??= []).push(sp.flags.comment);
      if (sp.flags?.bookmark) (p.bookmarks ??= []).push(sp.flags.bookmark);
      if (sp.flags) p.flags = { ...(p.flags ?? {}), ...sp.flags };
      if (sp.text) p.runs.push({ text: sp.text, flags: sp.flags });
    }
    return p;
  }

  private elementText(el: MemoryElement): string {
    if (el.kind === "paragraph") return el.runs.map((r) => r.text).join("");
    if (el.kind === "table") {
      return el.rows.map((r) => `| ${r.join(" | ")} |`).join(" ");
    }
    return "[Table of Contents]";
  }

  listElements(): AddressElement[] {
    return this.elements.map((el, idx) => ({
      number: idx + 1,
      kind: el.kind as AddressElementKind,
      id: el.id,
      style: el.kind === "paragraph" ? el.style : undefined,
      meta: el.kind === "table" ? `${el.rows.length}x${el.rows[0]?.length ?? 0}` : undefined,
      text: this.elementText(el),
    }));
  }

  replaceInElement(elementIndex: number, replacements: MatchReplacement[]): void {
    const el = this.elements[elementIndex];
    if (!el || el.kind !== "paragraph") return;

    // Flatten characters with their existing flags
    const chars: Array<{ ch: string; flags?: SedmatFormatFlags }> = [];
    for (const run of el.runs) {
      for (const ch of run.text) chars.push({ ch, flags: run.flags });
    }

    const nextRuns: MemoryRun[] = [];
    let cursor = 0;
    const pushSlice = (from: number, to: number): void => {
      for (let i = from; i < to; i++) {
        const c = chars[i]!;
        const prev = nextRuns[nextRuns.length - 1];
        if (prev && JSON.stringify(prev.flags ?? {}) === JSON.stringify(c.flags ?? {})) {
          prev.text += c.ch;
        } else {
          nextRuns.push({ text: c.ch, flags: c.flags });
        }
      }
    };

    for (const rep of replacements) {
      if (rep.start > cursor) pushSlice(cursor, rep.start);
      const baseFlags = chars[rep.start]?.flags;
      for (const sp of rep.spans) {
        if (sp.flags?.heading) el.style = sp.flags.heading;
        if (sp.flags?.comment) (el.comments ??= []).push(sp.flags.comment);
        if (sp.flags?.bookmark) (el.bookmarks ??= []).push(sp.flags.bookmark);
        if (sp.flags?.table?.kind === "create") {
          const { rows, cols, header } = sp.flags.table;
          this.elements.splice(elementIndex + 1, 0, {
            kind: "table",
            id: `tbl_${this.nextId++}`,
            header,
            rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => "")),
          });
        }
        if (sp.flags?.toc) {
          this.elements.splice(elementIndex + 1, 0, {
            kind: "toc",
            id: `toc_${this.nextId++}`,
            maxDepth: sp.flags.toc.maxDepth,
          });
        }
        const mergedFlags = sp.flags?.reset
          ? { ...sp.flags }
          : baseFlags || sp.flags
            ? { ...(baseFlags ?? {}), ...(sp.flags ?? {}) }
            : undefined;
        if (sp.text) {
          nextRuns.push({ text: sp.text, flags: mergedFlags });
        }
      }
      cursor = rep.end;
    }

    if (cursor < chars.length) pushSlice(cursor, chars.length);
    el.runs = nextRuns;
  }

  deleteElements(elementIndices: number[]): void {
    const desc = [...elementIndices].sort((a, b) => b - a);
    for (const idx of desc) {
      this.elements.splice(idx, 1);
    }
    if (this.elements.length === 0) {
      this.elements.push(this.makeParagraph(""));
    }
  }

  insertElements(
    position: "before" | "after" | "replace",
    anchorIndex: number,
    paragraphs: SedmatStyledSpan[][],
  ): void {
    const built = paragraphs.map((spans) => this.makeParagraphFromSpans(spans));
    if (position === "before") {
      this.elements.splice(anchorIndex, 0, ...built);
    } else if (position === "after") {
      this.elements.splice(anchorIndex + 1, 0, ...built);
    } else {
      this.elements.splice(anchorIndex, 1, ...built);
    }
  }

  transliterateElement(elementIndex: number, charMap: ReadonlyMap<string, string>): boolean {
    const el = this.elements[elementIndex];
    if (!el || el.kind !== "paragraph") return false;
    let changed = false;
    for (const run of el.runs) {
      const next = [...run.text]
        .map((ch) => {
          const mapped = charMap.get(ch);
          if (mapped !== undefined) {
            changed = true;
            return mapped;
          }
          return ch;
        })
        .join("");
      run.text = next;
    }
    return changed;
  }

  applyPositionalInsert(
    positional: PositionalPattern,
    paragraphs: SedmatStyledSpan[][],
    tableCreate?: Extract<TableSpec, { kind: "create" }>,
  ): number {
    const built: MemoryElement[] = tableCreate
      ? [
          {
            kind: "table",
            id: `tbl_${this.nextId++}`,
            header: tableCreate.header,
            rows: Array.from({ length: tableCreate.rows }, () =>
              Array.from({ length: tableCreate.cols }, () => ""),
            ),
          },
        ]
      : paragraphs.map((spans) => this.makeParagraphFromSpans(spans));

    if (positional === "emptyDoc") {
      const isEmpty = this.elements.every(
        (el) => el.kind === "paragraph" && this.elementText(el).trim() === "",
      );
      if (!isEmpty) return 0;
      this.elements = built;
      return 1;
    }
    if (positional === "startOfDoc") {
      this.elements.unshift(...built);
      return 1;
    }
    this.elements.push(...built);
    return 1;
  }

  applyTableOp(spec: TableSpec, replacement: string, spans: SedmatStyledSpan[]): number {
    if (spec.kind === "create") {
      this.elements.push({
        kind: "table",
        id: `tbl_${this.nextId++}`,
        header: spec.header,
        rows: Array.from({ length: spec.rows }, () => Array.from({ length: spec.cols }, () => "")),
      });
      return 1;
    }

    const tables: Array<{ elIdx: number; tbl: MemoryTable }> = [];
    this.elements.forEach((el, elIdx) => {
      if (el.kind === "table") tables.push({ elIdx, tbl: el });
    });

    const selected =
      spec.table === "*"
        ? tables
        : (() => {
            const idx = spec.table > 0 ? spec.table - 1 : tables.length + spec.table;
            return tables[idx] ? [tables[idx]!] : [];
          })();

    if (selected.length === 0) return 0;

    if (spec.kind === "ref" && replacement === "") {
      for (const item of [...selected].sort((a, b) => b.elIdx - a.elIdx)) {
        this.elements.splice(item.elIdx, 1);
      }
      return selected.length;
    }

    const cellValue = spans.map((s) => s.text).join("") || replacement;
    let touched = 0;

    for (const { tbl } of selected) {
      if (spec.kind === "cell") {
        for (let r = 0; r < tbl.rows.length; r++) {
          if (spec.cell.row !== "*" && spec.cell.row !== r + 1) continue;
          const row = tbl.rows[r]!;
          for (let c = 0; c < row.length; c++) {
            if (spec.cell.col !== "*" && spec.cell.col !== c + 1) continue;
            row[c] = cellValue;
            touched++;
          }
        }
      } else if (spec.kind === "allCells") {
        for (const row of tbl.rows) {
          for (let c = 0; c < row.length; c++) {
            row[c] = cellValue;
            touched++;
          }
        }
      } else if (spec.kind === "range") {
        for (let r = spec.from.row - 1; r < spec.to.row && r < tbl.rows.length; r++) {
          const row = tbl.rows[r]!;
          for (let c = spec.from.col - 1; c < spec.to.col && c < row.length; c++) {
            row[c] = replacement === "merge" ? row[c]! : cellValue;
            touched++;
          }
        }
      } else if (spec.kind === "rowOp") {
        const cols = tbl.rows[0]?.length ?? 1;
        if (spec.op === "append") {
          tbl.rows.push(Array.from({ length: cols }, () => ""));
          touched++;
        } else if (spec.op === "insertBefore" && spec.index) {
          tbl.rows.splice(Math.max(0, spec.index - 1), 0, Array.from({ length: cols }, () => ""));
          touched++;
        } else if (spec.op === "delete" && spec.index) {
          const idx = spec.index > 0 ? spec.index - 1 : tbl.rows.length + spec.index;
          if (idx >= 0 && idx < tbl.rows.length) {
            tbl.rows.splice(idx, 1);
            touched++;
          }
        }
      } else if (spec.kind === "colOp") {
        if (spec.op === "append") {
          for (const row of tbl.rows) row.push("");
          touched++;
        } else if (spec.op === "insertBefore" && spec.index) {
          const idx = Math.max(0, spec.index - 1);
          for (const row of tbl.rows) row.splice(idx, 0, "");
          touched++;
        } else if (spec.op === "delete" && spec.index) {
          const colLen = tbl.rows[0]?.length ?? 0;
          const idx = spec.index > 0 ? spec.index - 1 : colLen + spec.index;
          if (idx >= 0 && idx < colLen) {
            for (const row of tbl.rows) row.splice(idx, 1);
            touched++;
          }
        }
      }
    }

    return touched;
  }

  applyImageOp(spec: ImageSpec, replacement: string, spans: SedmatStyledSpan[]): number {
    const indices: number[] = [];
    if (spec.kind === "all") {
      this.images.forEach((_, i) => indices.push(i));
    } else if (spec.kind === "index") {
      const idx = spec.index > 0 ? spec.index - 1 : this.images.length + spec.index;
      if (idx >= 0 && idx < this.images.length) indices.push(idx);
    } else if (spec.kind === "regex") {
      const re = new RegExp(spec.pattern);
      this.images.forEach((img, i) => {
        if (re.test(img.alt)) indices.push(i);
      });
    }
    if (indices.length === 0) return 0;

    if (replacement === "") {
      for (const idx of [...indices].sort((a, b) => b - a)) {
        this.images.splice(idx, 1);
      }
      return indices.length;
    }

    const repFlags = spans[0]?.flags;
    for (const idx of indices) {
      const img = this.images[idx]!;
      if (repFlags?.image?.kind === "url") img.url = repFlags.image.url;
      if (repFlags?.width) img.width = repFlags.width;
      if (repFlags?.height) img.height = repFlags.height;
    }
    return indices.length;
  }

  applyContainerFlags(_elementIndex: number, flags: SedmatFormatFlags): void {
    if (flags.cols !== undefined && flags.cols !== null) {
      this.sectionCols = flags.cols;
    }
  }
}
