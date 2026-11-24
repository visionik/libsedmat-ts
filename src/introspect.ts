import type { AddressElement, DocumentProjection, DocumentSegment, DocumentTable } from "./types.ts";

function tablePreview(t: DocumentTable): string {
  if (t.rows.length === 0) return "[empty table]";
  const preview = t.rows[0]!.cells.map((c) => c.text.replace(/\n+$/, "").trim()).join(" | ");
  return preview.length > 60 ? `${preview.slice(0, 57)}...` : preview;
}

function truncatePreview(s: string, maxLen = 60): string {
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 3)}...`;
}

export function addressElements(seg: DocumentSegment): AddressElement[] {
  const elements: AddressElement[] = [];
  let num = 0;
  for (const block of seg.blocks) {
    if (block.kind === "section_break") continue;
    num++;
    if (block.kind === "paragraph") {
      const p = block.itemIndex >= 0 ? seg.paragraphs[block.itemIndex] : undefined;
      elements.push({
        number: num,
        kind: "paragraph",
        text: (p?.text ?? "").replace(/\n+$/, ""),
        startIndex: block.startIndex,
        endIndex: block.endIndex,
      });
    } else if (block.kind === "table") {
      const t = block.itemIndex >= 0 ? seg.tables[block.itemIndex] : undefined;
      elements.push({
        number: num,
        kind: "table",
        text: t ? tablePreview(t) : "[empty table]",
        startIndex: block.startIndex,
        endIndex: block.endIndex,
      });
    } else if (block.kind === "table_of_contents") {
      elements.push({
        number: num,
        kind: "toc",
        text: "[table of contents]",
        startIndex: block.startIndex,
        endIndex: block.endIndex,
      });
    }
  }
  return elements;
}

export function selectSegment(proj: DocumentProjection, tabId = ""): DocumentSegment {
  if (tabId) {
    const lower = tabId.toLowerCase();
    const found = proj.tabs.find((t) => t.tabId === tabId || t.title.toLowerCase() === lower);
    if (!found) {
      throw new Error(`tab "${tabId}" not found`);
    }
    return found;
  }
  if (proj.legacy) return proj.legacy;
  if (proj.tabs.length > 0) return proj.tabs[0]!;
  throw new Error("document has no content");
}

export function formatStructure(seg: DocumentSegment): string {
  const lines: string[] = [];
  let num = 0;
  for (const block of seg.blocks) {
    if (block.kind === "section_break") continue;
    num++;
    if (block.kind === "paragraph") {
      const p = block.itemIndex >= 0 ? seg.paragraphs[block.itemIndex] : undefined;
      const style = p?.namedStyle || "NORMAL_TEXT";
      const bullet = p?.bulletListId ? ` [bullet L${p.bulletNestingLevel ?? 0}]` : "";
      const preview = truncatePreview((p?.text ?? "").replace(/\n+$/, ""));
      lines.push(`[${num}] paragraph (${style}${bullet}): ${JSON.stringify(preview)}`);
    } else if (block.kind === "table") {
      const t = block.itemIndex >= 0 ? seg.tables[block.itemIndex] : undefined;
      const rows = t ? t.rows.length || t.declaredRows : 0;
      const cols = t ? (t.rows[0]?.cells.length ?? t.declaredColumns) : 0;
      const preview = t ? tablePreview(t) : "[empty table]";
      lines.push(`[${num}] table (${rows}x${cols}): ${JSON.stringify(preview)}`);
    } else if (block.kind === "table_of_contents") {
      lines.push(`[${num}] toc: "[table of contents]"`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function formatNumbered(seg: DocumentSegment): string {
  const elems = addressElements(seg);
  return elems.length ? `${elems.map((e) => `[${e.number}] ${e.text}`).join("\n")}\n` : "";
}
