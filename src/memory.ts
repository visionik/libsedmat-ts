import type {
  AddressElement,
  AddressMutation,
  Backend,
  ContainerScope,
  DocumentBlock,
  DocumentParagraph,
  DocumentProjection,
  DocumentSegment,
  DocumentTable,
  DocumentTableCell,
  DocumentTableRow,
  DocumentTextRun,
  Expression,
  FootnoteMutation,
  FormatIntent,
  ImageMutation,
  TableCreateMutation,
  TableCreateSpec,
  TextPlan,
} from "./types.ts";

export interface MemoryParagraph {
  text: string;
  namedStyle: string;
  bulletListId?: string;
  bulletNestingLevel?: number;
}

export interface MemoryTable {
  rows: string[][];
  header: boolean;
}

export type MemoryElement =
  | { kind: "paragraph"; paragraph: MemoryParagraph }
  | { kind: "table"; table: MemoryTable }
  | { kind: "toc" };

export interface MemoryTab {
  id: string;
  title: string;
  layout?: string;
  background?: string;
  notes?: string;
  transition?: string;
  hidden?: boolean;
  elements: MemoryElement[];
  formatting: FormatIntent[];
  images: ImageMutation[];
  footnotes: FootnoteMutation[];
}

export class MemoryDocument implements Backend {
  id = "mem-doc-1";
  revisionId = "rev-1";
  tabs: MemoryTab[] = [];

  constructor(...paragraphs: string[]) {
    const tab: MemoryTab = {
      id: "",
      title: "Default",
      elements: paragraphs.map((text) => ({
        kind: "paragraph",
        paragraph: { text, namedStyle: "NORMAL_TEXT" },
      })),
      formatting: [],
      images: [],
      footnotes: [],
    };
    this.tabs.push(tab);
  }

  addTab(id: string, title: string, ...paragraphs: string[]): MemoryTab {
    const tab: MemoryTab = {
      id,
      title,
      elements: paragraphs.map((text) => ({
        kind: "paragraph",
        paragraph: { text, namedStyle: "NORMAL_TEXT" },
      })),
      formatting: [],
      images: [],
      footnotes: [],
    };
    this.tabs.push(tab);
    return tab;
  }

  addTable(rows: string[][], header = false, tabId = ""): void {
    const tab = this.findTab(tabId);
    tab.elements.push({
      kind: "table",
      table: { rows: rows.map((r) => [...r]), header },
    });
  }

  addToc(tabId = ""): void {
    const tab = this.findTab(tabId);
    tab.elements.push({ kind: "toc" });
  }

  paragraphTexts(tabId = ""): string[] {
    const tab = this.findTab(tabId);
    return tab.elements
      .filter((el): el is { kind: "paragraph"; paragraph: MemoryParagraph } => el.kind === "paragraph")
      .map((el) => el.paragraph.text);
  }

  plainText(tabId = ""): string {
    return this.paragraphTexts(tabId).join("\n");
  }

  tables(tabId = ""): MemoryTable[] {
    const tab = this.findTab(tabId);
    return tab.elements
      .filter((el): el is { kind: "table"; table: MemoryTable } => el.kind === "table")
      .map((el) => el.table);
  }

  formatting(tabId = ""): FormatIntent[] {
    return [...this.findTab(tabId).formatting];
  }

  project(): DocumentProjection {
    const proj: DocumentProjection = {
      documentId: this.id,
      revisionId: this.revisionId,
      tabs: [],
    };
    for (let i = 0; i < this.tabs.length; i++) {
      const seg = projectTab(this.tabs[i]!);
      if (i === 0 && this.tabs[i]!.id === "") {
        proj.legacy = seg;
      }
      proj.tabs.push(seg);
    }
    return proj;
  }

  applyTextPlan(tabId: string, plan: TextPlan): void {
    const tab = this.findTab(tabId);
    const edits = [...plan.textEdits].sort((a, b) => b.startIndex - a.startIndex);
    for (const edit of edits) {
      applyRangeEdit(tab, edit.startIndex, edit.endIndex, edit.insertText);
    }
    tab.formatting.push(...plan.formatting);
    tab.images.push(...plan.images);
    tab.footnotes.push(...plan.footnotes);

    const seg = projectTab(tab);
    for (const intent of plan.formatting) {
      const heading = extractHeadingStyle(intent);
      if (!heading) continue;
      for (const block of seg.blocks) {
        if (block.kind !== "paragraph") continue;
        if (intent.structuralStartIndex >= block.startIndex && intent.structuralStartIndex < block.endIndex) {
          let pIdx = 0;
          for (const el of tab.elements) {
            if (el.kind === "paragraph") {
              if (pIdx === block.itemIndex) {
                el.paragraph.namedStyle = heading;
              }
              pIdx++;
            }
          }
        }
      }
    }
  }

  applyAddressMutations(tabId: string, mutations: AddressMutation[]): void {
    const tab = this.findTab(tabId);
    const ordered = [...mutations].sort((a, b) =>
      a.startIndex !== b.startIndex ? b.startIndex - a.startIndex : b.endIndex - a.endIndex,
    );
    for (const m of ordered) {
      if (m.insertText && (m.endIndex === 0 || m.endIndex === m.startIndex)) {
        applyInsertMutation(tab, m.startIndex, m.insertText);
      } else {
        applyDeleteMutation(tab, m.startIndex, m.endIndex);
      }
    }
  }

  applyTableCreate(tabId: string, mutation: TableCreateMutation, spec: TableCreateSpec): void {
    const tab = this.findTab(tabId);
    const seg = projectTab(tab);
    const blockIdx = seg.blocks.findIndex(
      (b) => mutation.startIndex >= b.startIndex && mutation.startIndex < b.endIndex,
    );
    const rows: string[][] = [];
    for (let r = 0; r < spec.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < spec.columns; c++) {
        row.push(spec.cells?.[r]?.[c] ?? "");
      }
      rows.push(row);
    }
    const tableEl: MemoryElement = { kind: "table", table: { rows, header: Boolean(spec.header) } };
    if (blockIdx >= 0 && blockIdx < tab.elements.length) {
      tab.elements[blockIdx] = tableEl;
    } else {
      tab.elements.push(tableEl);
    }
  }

  applyTransliterate(tabId: string, source: string, dest: string, targets: AddressElement[]): number {
    const tab = this.findTab(tabId);
    const srcChars = [...source];
    const dstChars = [...dest];
    const map = new Map<string, string>();
    for (let i = 0; i < srcChars.length; i++) {
      map.set(srcChars[i]!, dstChars[i]!);
    }
    const targetNums = new Set(targets.map((t) => t.number));
    let changed = 0;
    let num = 0;
    for (const el of tab.elements) {
      num++;
      if (targetNums.size > 0 && !targetNums.has(num)) continue;
      if (el.kind !== "paragraph") continue;
      let out = "";
      for (const ch of el.paragraph.text) {
        const repl = map.get(ch);
        if (repl !== undefined) {
          out += repl;
          changed++;
        } else {
          out += ch;
        }
      }
      el.paragraph.text = out;
    }
    return changed;
  }

  applyContainerOp(scope: ContainerScope, expr: Expression): number {
    const indices = this.resolveContainerIndices(scope);
    if (expr.command === "d") {
      for (let i = indices.length - 1; i >= 0; i--) {
        this.tabs.splice(indices[i]!, 1);
      }
      return indices.length;
    }
    if (expr.command === "a" || expr.command === "i") {
      const title = expr.replacement.replace(/\{[^}]*\}/g, "").trim() || `Tab ${this.tabs.length + 1}`;
      const newTab: MemoryTab = {
        id: `tab-${this.tabs.length + 1}`,
        title,
        layout: expr.brace?.layout,
        elements: [{ kind: "paragraph", paragraph: { text: title, namedStyle: "NORMAL_TEXT" } }],
        formatting: [],
        images: [],
        footnotes: [],
      };
      const anchor = indices[indices.length - 1] ?? this.tabs.length - 1;
      const insertAt = expr.command === "a" ? anchor + 1 : anchor;
      this.tabs.splice(insertAt, 0, newTab);
      return 1;
    }
    if (expr.command === "brace" && expr.brace) {
      for (const idx of indices) {
        const tab = this.tabs[idx]!;
        if (expr.brace.bg) tab.background = expr.brace.bg;
        if (expr.brace.notes) tab.notes = expr.brace.notes;
        if (expr.brace.transition) tab.transition = expr.brace.transition;
        if (expr.brace.layout) tab.layout = expr.brace.layout;
        if (expr.brace.hide) tab.hidden = true;
        if (expr.brace.dup) {
          const clone: MemoryTab = structuredClone(tab);
          clone.id = `${tab.id || "tab"}-copy`;
          this.tabs.splice(idx + 1, 0, clone);
        }
        if (expr.brace.move !== undefined && expr.brace.move >= 1 && expr.brace.move <= this.tabs.length) {
          const [moved] = this.tabs.splice(idx, 1);
          this.tabs.splice(expr.brace.move - 1, 0, moved!);
        }
      }
      return indices.length;
    }
    return 0;
  }

  private resolveContainerIndices(scope: ContainerScope): number[] {
    if (scope.all) return this.tabs.map((_, i) => i);
    if (scope.name) {
      const idx = this.tabs.findIndex(
        (t) => t.id === scope.name || t.title.toLowerCase() === scope.name!.toLowerCase(),
      );
      if (idx < 0) throw new Error(`container "${scope.name}" not found`);
      return [idx];
    }
    if (scope.address) {
      const total = this.tabs.length;
      if (total === 0) throw new Error("document has no containers");
      const start = scope.address.start === -1 ? total : scope.address.start;
      const end = !scope.address.hasRange ? start : scope.address.end === -1 ? total : scope.address.end;
      if (start < 1 || start > total || end < 1 || end > total || end < start) {
        throw new Error(`container address out of range (document has ${total} containers)`);
      }
      const out: number[] = [];
      for (let i = start - 1; i < end; i++) out.push(i);
      return out;
    }
    return this.tabs.length > 0 ? [0] : [];
  }

  private findTab(tabId: string): MemoryTab {
    if (!tabId) {
      if (this.tabs.length === 0) {
        this.tabs.push({ id: "", title: "Default", elements: [], formatting: [], images: [], footnotes: [] });
      }
      return this.tabs[0]!;
    }
    const found = this.tabs.find((t) => t.id === tabId || t.title.toLowerCase() === tabId.toLowerCase());
    if (!found) throw new Error(`tab "${tabId}" not found`);
    return found;
  }
}

function projectTab(tab: MemoryTab): DocumentSegment {
  const blocks: DocumentBlock[] = [];
  const textRuns: DocumentTextRun[] = [];
  const paragraphs: DocumentParagraph[] = [];
  const tables: DocumentTable[] = [];
  let cursor = 1;

  for (const el of tab.elements) {
    if (el.kind === "paragraph") {
      const fullText = `${el.paragraph.text}\n`;
      const start = cursor;
      const end = cursor + fullText.length;
      const pIdx = paragraphs.length;
      paragraphs.push({
        text: fullText,
        startIndex: start,
        endIndex: end,
        namedStyle: el.paragraph.namedStyle || "NORMAL_TEXT",
        bulletListId: el.paragraph.bulletListId,
        bulletNestingLevel: el.paragraph.bulletNestingLevel,
        leadingTab: fullText.startsWith("\t"),
      });
      textRuns.push({ text: fullText, startIndex: start, endIndex: end });
      blocks.push({ kind: "paragraph", startIndex: start, endIndex: end, itemIndex: pIdx });
      cursor = end;
    } else if (el.kind === "table") {
      const tStart = cursor;
      cursor++;
      const docRows: DocumentTableRow[] = [];
      let declCols = 0;
      for (const row of el.table.rows) {
        if (row.length > declCols) declCols = row.length;
        const rStart = cursor;
        cursor++;
        const docCells: DocumentTableCell[] = [];
        for (const cellText of row) {
          const cStart = cursor;
          cursor++;
          const fullCell = `${cellText}\n`;
          const tCellStart = cursor;
          const tCellEnd = cursor + fullCell.length;
          cursor = tCellEnd;
          docCells.push({
            text: fullCell,
            startIndex: cStart,
            endIndex: cursor,
            textStartIndex: tCellStart,
            textEndIndex: tCellEnd,
            rowSpan: 1,
            columnSpan: 1,
          });
        }
        docRows.push({ startIndex: rStart, endIndex: cursor, cells: docCells });
      }
      const tIdx = tables.length;
      tables.push({
        startIndex: tStart,
        endIndex: cursor,
        declaredRows: el.table.rows.length,
        declaredColumns: declCols,
        rows: docRows,
      });
      blocks.push({ kind: "table", startIndex: tStart, endIndex: cursor, itemIndex: tIdx });
    } else if (el.kind === "toc") {
      const start = cursor;
      cursor += 2;
      blocks.push({ kind: "table_of_contents", startIndex: start, endIndex: cursor, itemIndex: -1 });
    }
  }

  return {
    tabId: tab.id,
    title: tab.title,
    bodyStartIndex: 1,
    bodyEndIndex: cursor,
    blocks,
    textRuns,
    paragraphs,
    tables,
    images: [],
  };
}

function applyRangeEdit(tab: MemoryTab, startIdx: number, endIdx: number, insertText: string): void {
  const seg = projectTab(tab);
  let pCursor = 0;
  for (let i = 0; i < tab.elements.length; i++) {
    const el = tab.elements[i]!;
    if (el.kind === "paragraph") {
      const p = seg.paragraphs[pCursor++]!;
      if (startIdx >= p.startIndex && endIdx <= p.endIndex) {
        const relStart = startIdx - p.startIndex;
        const relEnd = endIdx - p.startIndex;
        const updated = p.text.slice(0, relStart) + insertText + p.text.slice(relEnd);
        const trimmed = updated.endsWith("\n") ? updated.slice(0, -1) : updated;
        const parts = trimmed.split("\n");
        if (parts.length === 1) {
          el.paragraph.text = parts[0]!;
        } else {
          const newElems: MemoryElement[] = parts.map((text) => ({
            kind: "paragraph",
            paragraph: { text, namedStyle: el.paragraph.namedStyle },
          }));
          tab.elements.splice(i, 1, ...newElems);
        }
        return;
      }
    }
  }

  let tCursor = 0;
  for (const el of tab.elements) {
    if (el.kind === "table") {
      const dt = seg.tables[tCursor++]!;
      for (let r = 0; r < dt.rows.length; r++) {
        const row = dt.rows[r]!;
        for (let c = 0; c < row.cells.length; c++) {
          const cell = row.cells[c]!;
          if (startIdx >= cell.textStartIndex && endIdx <= cell.textEndIndex) {
            const relStart = startIdx - cell.textStartIndex;
            const relEnd = endIdx - cell.textStartIndex;
            const updated = cell.text.slice(0, relStart) + insertText + cell.text.slice(relEnd);
            el.table.rows[r]![c] = updated.endsWith("\n") ? updated.slice(0, -1) : updated;
            return;
          }
        }
      }
    }
  }

  throw new Error(`edit range [${startIdx},${endIdx}) not found in document`);
}

function applyInsertMutation(tab: MemoryTab, index: number, insertText: string): void {
  const seg = projectTab(tab);
  const isAppend = insertText.startsWith("\n");
  let cleaned = isAppend ? insertText.slice(1) : insertText;
  if (cleaned.endsWith("\n")) cleaned = cleaned.slice(0, -1);
  const newElems: MemoryElement[] = cleaned.split("\n").map((text) => ({
    kind: "paragraph",
    paragraph: { text, namedStyle: "NORMAL_TEXT" },
  }));

  for (let i = 0; i < seg.blocks.length; i++) {
    const b = seg.blocks[i]!;
    if (isAppend && (index === b.endIndex - 1 || index === b.endIndex)) {
      tab.elements.splice(i + 1, 0, ...newElems);
      return;
    }
    if (!isAppend && index === b.startIndex) {
      tab.elements.splice(i, 0, ...newElems);
      return;
    }
    if (!isAppend && index === b.endIndex) {
      tab.elements.splice(i + 1, 0, ...newElems);
      return;
    }
  }
  tab.elements.push(...newElems);
}

function applyDeleteMutation(tab: MemoryTab, startIdx: number, endIdx: number): void {
  const seg = projectTab(tab);
  if (seg.blocks.length === 0) return;
  if (seg.blocks.length === 1 && startIdx >= seg.blocks[0]!.startIndex && endIdx <= seg.blocks[0]!.endIndex) {
    tab.elements[0] = { kind: "paragraph", paragraph: { text: "", namedStyle: "NORMAL_TEXT" } };
    return;
  }
  const kept: MemoryElement[] = [];
  for (let i = 0; i < seg.blocks.length; i++) {
    const b = seg.blocks[i]!;
    if (startIdx === b.endIndex - 1 && endIdx > b.endIndex) {
      kept.push(tab.elements[i]!);
      continue;
    }
    if (
      (b.startIndex >= startIdx && b.endIndex <= endIdx) ||
      (b.startIndex >= startIdx && b.endIndex - 1 <= endIdx && i === seg.blocks.length - 1)
    ) {
      continue;
    }
    kept.push(tab.elements[i]!);
  }
  if (kept.length === 0) {
    kept.push({ kind: "paragraph", paragraph: { text: "", namedStyle: "NORMAL_TEXT" } });
  }
  tab.elements = kept;
}

function extractHeadingStyle(intent: FormatIntent): string {
  if (intent.brace?.heading) {
    const h = intent.brace.heading.toLowerCase();
    if (h === "t" || h === "title") return "TITLE";
    if (h === "s" || h === "subtitle") return "SUBTITLE";
    if (h === "0" || h === "n" || h === "normal") return "NORMAL_TEXT";
    if (/^[1-6]$/.test(h)) return `HEADING_${h}`;
  }
  for (const f of intent.formats) {
    if (/^heading[1-6]$/.test(f)) return `HEADING_${f.slice(7)}`;
  }
  return "";
}
