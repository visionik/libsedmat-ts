/**
 * Context-aware IntelliSense / IntelliCode completion, live grammar signatures,
 * structured diagnostics, and lightweight syntax tokenization for SEDMAT v3.6 / v3.7.
 *
 * UI-agnostic and zero-dependency: usable from web editor bars, TUIs, CLIs, and LSPs.
 */

import { SEDMAT_NAMED_COLORS } from "./colors.js";

export type SedmatSuggestionKind = "scope" | "command" | "flag" | "value" | "snippet";

export type SedmatProfile = "document" | "word" | "slides" | "spreadsheet" | "vector" | "timeline" | "all";

export interface SedmatSuggestion {
  label: string;
  insertText: string;
  replaceFrom: number;
  replaceTo: number;
  detail: string;
  kind: SedmatSuggestionKind;
  /** Optional hex color swatch (`#RRGGBB`) for color value completions */
  swatch?: string;
}

export interface SedmatSignaturePart {
  text: string;
  active?: boolean;
}

export interface SedmatIntelliSenseResult {
  contextTitle: string;
  signature: SedmatSignaturePart[];
  suggestions: SedmatSuggestion[];
  /** Dimmed inline ghost text suffix when cursor is at end of input */
  ghostSuffix?: string;
}

export interface SedmatFlagDefinition {
  key: string;
  insert: string;
  detail: string;
  profiles?: SedmatProfile[];
}

export interface SedmatValueOption {
  value: string;
  detail: string;
  swatch?: string;
}

export interface SedmatSnippetOption {
  label: string;
  insert: string;
  detail: string;
  kind: SedmatSuggestionKind;
  swatch?: string;
}

export interface SedmatIntelliSenseExtensions {
  flags?: SedmatFlagDefinition[];
  values?: Record<string, SedmatValueOption[]>;
  starters?: SedmatSnippetOption[];
  scopeSnippets?: SedmatSnippetOption[];
}

export interface SedmatContextInfo {
  /** Target capability profile (`"document"` and `"word"` are aliases). */
  mode?: SedmatProfile;
  /** 1-based active container index (slide, page, sheet, tab). */
  activeContainer?: number;
  /** Total containers in document. */
  totalContainers?: number;
  /** Alias for `activeContainer` (compatibility with Slides/Studio callers). */
  activeSlide?: number;
  /** Alias for `totalContainers` (compatibility with Slides/Studio callers). */
  totalSlides?: number;
  /** Optional host-app custom flags, value completions, or starter snippets. */
  extensions?: SedmatIntelliSenseExtensions;
}

export interface SedmatPreviewStatus {
  ok: boolean;
  summary: string;
  /** Optional 0-based character offset in the input string where the error occurred */
  errorOffset?: number;
  /** Optional character span length to underline/highlight */
  errorLength?: number;
  /** Optional actionable hint shown below the error message */
  hint?: string;
}

export type SedmatTokenKind =
  | "comment"
  | "scope"
  | "address"
  | "command"
  | "delimiter"
  | "pattern"
  | "brace"
  | "text"
  | "flag"
  | "whitespace";

export interface SedmatToken {
  kind: SedmatTokenKind;
  start: number;
  end: number;
  text: string;
}

/** Extract structured error offset, span length, clean reason, and hint from any thrown SEDMAT error. */
export function extractSedmatDiagnostic(err: unknown): SedmatPreviewStatus {
  if (err && typeof err === "object") {
    const e = err as {
      offset?: unknown;
      length?: unknown;
      reason?: unknown;
      hint?: unknown;
      message?: unknown;
    };
    const offset = typeof e.offset === "number" ? e.offset : undefined;
    const length = typeof e.length === "number" ? Math.max(1, e.length) : undefined;
    const reason = typeof e.reason === "string" ? e.reason : undefined;
    const hint = typeof e.hint === "string" ? e.hint : undefined;
    if (offset !== undefined || reason) {
      return {
        ok: false,
        summary: reason ?? (typeof e.message === "string" ? e.message : String(err)),
        errorOffset: offset,
        errorLength: length ?? 1,
        hint,
      };
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  const offMatch = /at offset (\d+):\s*(.+)$/i.exec(msg);
  if (offMatch) {
    const rawRest = offMatch[2]!;
    const dashSplit = rawRest.split(/\s+—\s+/);
    return {
      ok: false,
      summary: dashSplit[0] ?? rawRest,
      errorOffset: Number.parseInt(offMatch[1]!, 10),
      errorLength: 1,
      hint: dashSplit[1],
    };
  }
  return { ok: false, summary: msg };
}

function normalizeProfile(mode?: SedmatProfile): Exclude<SedmatProfile, "word"> {
  if (!mode || mode === "word") return "document";
  return mode;
}

function matchesProfile(def: SedmatFlagDefinition, profile: Exclude<SedmatProfile, "word">): boolean {
  if (profile === "all" || !def.profiles) return true;
  return def.profiles.some((p) => (p === "word" ? "document" : p) === profile);
}

const FLAG_DEFS: SedmatFlagDefinition[] = [
  // Timeline directives
  { key: "+2d", insert: "+2d", detail: "Extend task duration by +2 working days", profiles: ["timeline"] },
  { key: "-1d", insert: "-1d", detail: "Shorten task duration by -1 working day", profiles: ["timeline"] },
  { key: "5d", insert: "5d", detail: "Set exact task duration to 5 working days", profiles: ["timeline"] },
  { key: "+4h", insert: "+4h", detail: "Extend task duration by +4 working hours", profiles: ["timeline"] },
  { key: "50%", insert: "50%", detail: "Set task completion to 50%", profiles: ["timeline"] },
  { key: "100%", insert: "100%", detail: "Mark task 100% complete", profiles: ["timeline"] },
  { key: "milestone", insert: "milestone", detail: "Convert task into a 0-day milestone", profiles: ["timeline"] },
  // Core inline formatting
  { key: "b", insert: "b", detail: "Bold", profiles: ["document", "slides", "spreadsheet", "vector"] },
  { key: "i", insert: "i", detail: "Italic", profiles: ["document", "slides", "spreadsheet", "vector"] },
  { key: "_", insert: "_", detail: "Underline", profiles: ["document", "slides", "spreadsheet"] },
  { key: "-", insert: "-", detail: "Strikethrough", profiles: ["document", "slides", "spreadsheet"] },
  { key: "c=", insert: "c=", detail: "Text / foreground color (red, blue, #FF0000…)" },
  { key: "z=", insert: "z=", detail: "Background / highlight / fill color" },
  { key: "s=", insert: "s=", detail: "Font size in pt (e.g. s=14)", profiles: ["document", "slides", "spreadsheet", "vector"] },
  { key: "f=", insert: "f=", detail: "Font family (e.g. f=Inter)", profiles: ["document", "slides", "spreadsheet", "vector"] },
  { key: "a=", insert: "a=", detail: "Alignment (left, center, right, justify)", profiles: ["document", "slides", "spreadsheet", "vector"] },
  { key: "t=", insert: "t=", detail: "Replacement text while styling match", profiles: ["document", "slides", "vector"] },
  { key: "u=", insert: "u=", detail: "Hyperlink URL, #bookmark, or chip:// URI", profiles: ["document", "slides", "spreadsheet"] },
  { key: "#", insert: "#", detail: "Inline monospace code", profiles: ["document", "slides"] },
  { key: "w", insert: "w", detail: "Small caps", profiles: ["document", "slides"] },
  { key: "^", insert: "^", detail: "Superscript", profiles: ["document", "slides"] },
  { key: ",", insert: ",", detail: "Subscript", profiles: ["document", "slides"] },
  { key: "!b", insert: "!b", detail: "Remove bold (negate any boolean flag with !)", profiles: ["document", "slides", "vector"] },
  { key: "!0", insert: "!0", detail: "Additive mode (opt out of implicit reset)", profiles: ["document", "slides", "spreadsheet", "vector"] },
  { key: "0", insert: "0", detail: "Reset all formatting", profiles: ["document", "slides", "spreadsheet", "vector"] },
  // Slides, Vector & Shape flags (v3.7)
  { key: "shape=", insert: "shape=", detail: "Shape geometry (roundRect, rect, diamond, ellipse…)", profiles: ["slides", "vector"] },
  { key: "fill=", insert: "fill=", detail: "Shape fill hex or named color", profiles: ["slides", "vector", "timeline"] },
  { key: "stroke=", insert: "stroke=", detail: "Shape border hex or named color", profiles: ["slides", "vector"] },
  { key: "layout=", insert: "layout=", detail: "Slide layout (title, content, two-col, section, blank)", profiles: ["slides"] },
  { key: "zone=", insert: "zone=", detail: "Placement zone (left, right, top, bottom, center, footer)", profiles: ["slides"] },
  { key: "transition=", insert: "transition=", detail: "Slide transition (fade, push, wipe, none)", profiles: ["slides"] },
  { key: "move=", insert: "move=", detail: "Move container to 1-based position (e.g. @3{move=1})", profiles: ["slides", "spreadsheet"] },
  { key: "dup", insert: "dup", detail: "Duplicate container (e.g. @2{dup})", profiles: ["slides", "vector", "spreadsheet"] },
  { key: "hide", insert: "hide", detail: "Hide container", profiles: ["slides", "spreadsheet"] },
  // Document-specific structural flags
  { key: "h=", insert: "h=", detail: "Heading level (t=Title, s=Subtitle, 1..6, 0=Normal)", profiles: ["document"] },
  { key: "p=", insert: "p=", detail: "Paragraph spacing before,after pt (e.g. p=12,6)", profiles: ["document"] },
  { key: "n=", insert: "n=", detail: "Paragraph left indent level", profiles: ["document"] },
  { key: "cols=", insert: "cols=", detail: "Section columns (e.g. cols=2)", profiles: ["document"] },
  { key: "\"=", insert: "\"=", detail: "Attach review comment (e.g. \"=Check figure)", profiles: ["document"] },
  { key: "@=", insert: "@=", detail: "Insert bookmark anchor (e.g. @=summary)", profiles: ["document"] },
  { key: "check", insert: "check", detail: "Insert checkbox (check or check=y)", profiles: ["document"] },
  { key: "toc", insert: "toc", detail: "Insert Table of Contents", profiles: ["document"] },
  { key: "+=p", insert: "+=p", detail: "Insert page break (+, +=p, +=c, +=s)", profiles: ["document"] },
  // Tables & images
  { key: "T=", insert: "T=", detail: "Table create/cell ref (T=3x4:header or T=1!A1)", profiles: ["document", "slides"] },
  { key: "img=", insert: "img=", detail: "Target image by 1-based index (img=1, img=-1)", profiles: ["document", "slides"] },
  { key: "x=", insert: "x=", detail: "Image width in px (e.g. x=420)", profiles: ["document", "slides"] },
];

/** Canonical color completion values derived directly from `SEDMAT_NAMED_COLORS` (sedmat.org). */
const COLOR_VALUES: SedmatValueOption[] = [
  { value: "red", detail: "Canonical red", swatch: `#${SEDMAT_NAMED_COLORS.red}` },
  { value: "blue", detail: "Canonical blue", swatch: `#${SEDMAT_NAMED_COLORS.blue}` },
  { value: "green", detail: "Canonical green", swatch: `#${SEDMAT_NAMED_COLORS.green}` },
  { value: "orange", detail: "Canonical orange", swatch: `#${SEDMAT_NAMED_COLORS.orange}` },
  { value: "purple", detail: "Canonical purple", swatch: `#${SEDMAT_NAMED_COLORS.purple}` },
  { value: "navy", detail: "Canonical navy", swatch: `#${SEDMAT_NAMED_COLORS.navy}` },
  { value: "teal", detail: "Canonical teal", swatch: `#${SEDMAT_NAMED_COLORS.teal}` },
  { value: "gray", detail: "Canonical gray", swatch: `#${SEDMAT_NAMED_COLORS.gray}` },
  { value: "yellow", detail: "Highlight yellow", swatch: `#${SEDMAT_NAMED_COLORS.yellow}` },
  { value: "black", detail: "Canonical black", swatch: `#${SEDMAT_NAMED_COLORS.black}` },
  { value: "white", detail: "Canonical white", swatch: `#${SEDMAT_NAMED_COLORS.white}` },
];

const VALUE_COMPLETIONS: Record<string, SedmatValueOption[]> = {
  c: COLOR_VALUES,
  z: COLOR_VALUES,
  fill: COLOR_VALUES,
  stroke: COLOR_VALUES,
  a: [
    { value: "left", detail: "Align left" },
    { value: "center", detail: "Align center" },
    { value: "right", detail: "Align right" },
    { value: "justify", detail: "Justify paragraph" },
  ],
  h: [
    { value: "t", detail: "Document Title" },
    { value: "s", detail: "Subtitle" },
    { value: "1", detail: "Heading 1" },
    { value: "2", detail: "Heading 2" },
    { value: "3", detail: "Heading 3" },
    { value: "0", detail: "Normal paragraph" },
  ],
  layout: [
    { value: "content", detail: "Title + bullet body" },
    { value: "title", detail: "Centered cover title" },
    { value: "two-col", detail: "Two-column comparison" },
    { value: "section", detail: "Section divider header" },
    { value: "comparison", detail: "Side-by-side comparison" },
    { value: "blank", detail: "Blank canvas" },
  ],
  zone: [
    { value: "center", detail: "Center stage" },
    { value: "left", detail: "Left column" },
    { value: "right", detail: "Right column" },
    { value: "top", detail: "Upper band" },
    { value: "bottom", detail: "Lower band" },
    { value: "footer", detail: "Bottom footer" },
  ],
  shape: [
    { value: "roundRect", detail: "Rounded rectangle" },
    { value: "rect", detail: "Rectangle" },
    { value: "ellipse", detail: "Circle / oval" },
    { value: "diamond", detail: "Decision diamond" },
    { value: "rightArrow", detail: "Right arrow" },
    { value: "chevron", detail: "Process chevron" },
  ],
  transition: [
    { value: "fade", detail: "Smooth crossfade" },
    { value: "push", detail: "Slide push" },
    { value: "wipe", detail: "Directional wipe" },
    { value: "none", detail: "No transition" },
  ],
  f: [
    { value: "Arial", detail: "Classic sans-serif" },
    { value: "Calibri", detail: "Office sans-serif" },
    { value: "Georgia", detail: "Editorial serif" },
    { value: "Inter", detail: "Modern UI sans" },
    { value: "Consolas", detail: "Monospace code" },
  ],
  s: [
    { value: "11", detail: "11 pt default" },
    { value: "12", detail: "12 pt body" },
    { value: "16", detail: "16 pt lead" },
    { value: "24", detail: "24 pt heading" },
    { value: "36", detail: "36 pt title" },
  ],
};

function findOpenBrace(before: string): number {
  let depth = 0;
  let lastOpen = -1;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === "\\" && i + 1 < before.length) {
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      lastOpen = i;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) lastOpen = -1;
    }
  }
  return depth > 0 ? lastOpen : -1;
}

function countUnescapedSlashes(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\\" && i + 1 < str.length) {
      i++;
      continue;
    }
    if (str[i] === "/") count++;
  }
  return count;
}

function computeGhostSuffix(
  input: string,
  cursor: number,
  suggestions: SedmatSuggestion[],
): string | undefined {
  if (cursor !== input.length || suggestions.length === 0) return undefined;
  const top = suggestions[0]!;
  const typed = input.slice(top.replaceFrom, top.replaceTo);
  if (top.insertText.toLowerCase().startsWith(typed.toLowerCase()) && top.insertText.length > typed.length) {
    return top.insertText.slice(typed.length);
  }
  return undefined;
}

/** Produce live IntelliSense suggestions, grammar parameter hints, and ghost completion for SEDMAT v3.6 / v3.7. */
export function getSedmatCompletions(
  input: string,
  cursor: number,
  ctx: SedmatContextInfo = {},
): SedmatIntelliSenseResult {
  const profile = normalizeProfile(ctx.mode);
  const safeCursor = Math.max(0, Math.min(input.length, cursor));
  const before = input.slice(0, safeCursor);
  const containerNum = ctx.activeContainer ?? ctx.activeSlide ?? 1;

  // Support semicolon-chained commands: analyze only the segment after the last `;`
  const lastSemi = before.lastIndexOf(";");
  const segStart = lastSemi >= 0 ? lastSemi + 1 : 0;
  const rawSeg = before.slice(segStart);
  const leadingSpaces = rawSeg.length - rawSeg.trimStart().length;
  const cmdStart = segStart + leadingSpaces;
  const seg = before.slice(cmdStart);

  // 1. Inside `{...}` formatting / operation braces
  const braceIdx = findOpenBrace(before);
  if (braceIdx >= cmdStart) {
    const inside = before.slice(braceIdx + 1);
    const lastSpace = Math.max(inside.lastIndexOf(" "), inside.lastIndexOf("\t"));
    const tokenStart = braceIdx + 1 + lastSpace + 1;
    const token = before.slice(tokenStart);

    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const key = token.slice(0, eqIdx);
      const valTyped = token.slice(eqIdx + 1).toLowerCase();
      const valStart = tokenStart + eqIdx + 1;
      const valueList = ctx.extensions?.values?.[key] ?? VALUE_COMPLETIONS[key];
      if (valueList) {
        const filtered = valueList
          .filter((v) => !valTyped || v.value.toLowerCase().includes(valTyped) || v.detail.toLowerCase().includes(valTyped))
          .map<SedmatSuggestion>((v) => ({
            label: v.value,
            insertText: v.value,
            replaceFrom: valStart,
            replaceTo: safeCursor,
            detail: v.detail,
            kind: "value",
            swatch: v.swatch,
          }));
        return {
          contextTitle: `Value for {${key}=…}`,
          signature: [
            { text: "{ " },
            { text: `${key}=` },
            { text: "value", active: true },
            { text: " }" },
          ],
          suggestions: filtered,
          ghostSuffix: computeGhostSuffix(input, safeCursor, filtered),
        };
      }
    }

    const q = token.toLowerCase();
    const allFlags = [...(ctx.extensions?.flags ?? []), ...FLAG_DEFS];
    const relevantFlags = allFlags
      .filter((f) => matchesProfile(f, profile))
      .filter((f) => !q || f.key.toLowerCase().startsWith(q) || f.detail.toLowerCase().includes(q));

    const suggestions = relevantFlags.slice(0, 12).map<SedmatSuggestion>((f) => ({
      label: f.key,
      insertText: f.insert,
      replaceFrom: tokenStart,
      replaceTo: safeCursor,
      detail: f.detail,
      kind: "flag",
    }));

    return {
      contextTitle: "SEDMAT Brace Flags ({…})",
      signature: [
        { text: "{" },
        { text: "b i _ - c= z= s= f= a= !0 …", active: true },
        { text: "}" },
      ],
      suggestions,
      ghostSuffix: computeGhostSuffix(input, safeCursor, suggestions),
    };
  }

  // 2. Typing a `@` container scope prefix (`@`, `@2`, `@2:`, `@2:ti`)
  if (seg.startsWith("@")) {
    const firstColon = seg.indexOf(":");
    if (firstColon === -1) {
      const q = seg.toLowerCase();
      const baseScopes: SedmatSnippetOption[] =
        profile === "slides"
          ? [
              { label: `@${containerNum}:`, insert: `@${containerNum}:`, detail: `Target slide ${containerNum}`, kind: "scope" },
              { label: `@${containerNum}:title:`, insert: `@${containerNum}:title:`, detail: `Target slide ${containerNum} title`, kind: "scope" },
              { label: `@${containerNum}:body:`, insert: `@${containerNum}:body:`, detail: `Target slide ${containerNum} body`, kind: "scope" },
              { label: `@${containerNum}:notes:`, insert: `@${containerNum}:notes:`, detail: `Target slide ${containerNum} speaker notes`, kind: "scope" },
              { label: "@*:", insert: "@*:", detail: "Target ALL slides", kind: "scope" },
              { label: `@${containerNum}:{z=#0F172A}`, insert: `@${containerNum}:{z=#0F172A}`, detail: "Set slide background", kind: "snippet" },
              { label: "@$a/{layout=two-col}New Slide/", insert: "@$a/{layout=two-col}New Slide/", detail: "Append new slide", kind: "snippet" },
              { label: `@${containerNum}{dup}`, insert: `@${containerNum}{dup}`, detail: `Duplicate slide ${containerNum}`, kind: "command" },
              { label: `@${containerNum}{move=1}`, insert: `@${containerNum}{move=1}`, detail: `Move slide ${containerNum} to position 1`, kind: "command" },
              { label: `@${containerNum}d`, insert: `@${containerNum}d`, detail: `Delete slide ${containerNum}`, kind: "command" },
            ]
          : profile === "spreadsheet"
            ? [
                { label: `@${containerNum}:`, insert: `@${containerNum}:`, detail: `Target sheet ${containerNum}`, kind: "scope" },
                { label: "@sheet=", insert: "@sheet=", detail: "Target named worksheet", kind: "scope" },
                { label: "@*:", insert: "@*:", detail: "Target ALL sheets", kind: "scope" },
              ]
            : [
                { label: "@header:", insert: "@header:", detail: "Target document header", kind: "scope" },
                { label: "@footer:", insert: "@footer:", detail: "Target document footer", kind: "scope" },
                { label: `@${containerNum}:`, insert: `@${containerNum}:`, detail: `Target container ${containerNum}`, kind: "scope" },
                { label: "@*:", insert: "@*:", detail: "Target all containers", kind: "scope" },
              ];

      const scopeSnippets = [...(ctx.extensions?.scopeSnippets ?? []), ...baseScopes];
      const filtered = scopeSnippets
        .filter((s) => s.label.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q))
        .map<SedmatSuggestion>((s) => ({
          label: s.label,
          insertText: s.insert,
          replaceFrom: cmdStart,
          replaceTo: safeCursor,
          detail: s.detail,
          kind: s.kind,
        }));

      return {
        contextTitle: "Container Scope (@)",
        signature: [
          { text: "@container", active: true },
          { text: "[:region]:command" },
        ],
        suggestions: filtered,
        ghostSuffix: computeGhostSuffix(input, safeCursor, filtered),
      };
    }

    const afterFirstColon = seg.slice(firstColon + 1);
    const secondColon = afterFirstColon.indexOf(":");
    if (secondColon === -1 && !afterFirstColon.includes("/") && !afterFirstColon.startsWith("{")) {
      const tokenStart = cmdStart + firstColon + 1;
      const q = afterFirstColon.toLowerCase();
      const postScope: SedmatSnippetOption[] =
        profile === "slides"
          ? [
              { label: "title:", insert: "title:", detail: "Slide title placeholder", kind: "scope" },
              { label: "sub:", insert: "sub:", detail: "Slide subtitle placeholder", kind: "scope" },
              { label: "body:", insert: "body:", detail: "Slide body / bullets", kind: "scope" },
              { label: "notes:", insert: "notes:", detail: "Speaker notes", kind: "scope" },
              { label: "s/old/new/g", insert: "s/", detail: "Search & replace text or style", kind: "command" },
              { label: "a/text/", insert: "a/", detail: "Append bullet / paragraph", kind: "command" },
              { label: "d/pattern/", insert: "d/", detail: "Delete matching lines", kind: "command" },
              { label: "{z=#0F172A}", insert: "{z=", detail: "Set slide background color", kind: "flag" },
              { label: "{transition=fade}", insert: "{transition=", detail: "Set slide transition", kind: "flag" },
            ]
          : [
              { label: "s/old/new/g", insert: "s/", detail: "Search & replace in container", kind: "command" },
              { label: "a/text/", insert: "a/", detail: "Append paragraph", kind: "command" },
              { label: "d/pattern/", insert: "d/", detail: "Delete matching paragraphs", kind: "command" },
            ];

      const filtered = postScope
        .filter((item) => !q || item.label.toLowerCase().startsWith(q) || item.detail.toLowerCase().includes(q))
        .map<SedmatSuggestion>((item) => ({
          label: item.label,
          insertText: item.insert,
          replaceFrom: tokenStart,
          replaceTo: safeCursor,
          detail: item.detail,
          kind: item.kind,
        }));

      return {
        contextTitle: `Inside ${seg.slice(0, firstColon + 1)}`,
        signature: [
          { text: seg.slice(0, firstColon + 1) },
          { text: "region: | command | {flags}", active: true },
        ],
        suggestions: filtered,
        ghostSuffix: computeGhostSuffix(input, safeCursor, filtered),
      };
    }
  }

  // 3. Inside an active `s/.../.../...` substitution command
  const subMatch = /(?:^|:|\d|\$|\s)s\//.exec(seg);
  if (subMatch) {
    const afterS = seg.slice(subMatch.index + subMatch[0].length);
    const slashes = countUnescapedSlashes(afterS);
    if (slashes === 0) {
      return {
        contextTitle: "Substitution — Pattern (RegExp)",
        signature: [
          { text: "s/" },
          { text: "pattern", active: true },
          { text: "/replacement/[g i m N]" },
        ],
        suggestions: [
          {
            label: ".*/{b}/",
            insertText: ".*/{b}/",
            replaceFrom: safeCursor,
            replaceTo: safeCursor,
            detail: "Match entire element and apply formatting",
            kind: "snippet",
          },
        ],
      };
    }
    if (slashes === 1) {
      return {
        contextTitle: "Substitution — Replacement (type { for formatting flags)",
        signature: [
          { text: "s/pattern/" },
          { text: "{flags}replacement", active: true },
          { text: "/[g i m N]" },
        ],
        suggestions: [
          { label: "{b c=red}", insertText: "{b c=red}", replaceFrom: safeCursor, replaceTo: safeCursor, detail: "Bold red highlight (keeps matched text)", kind: "snippet", swatch: `#${SEDMAT_NAMED_COLORS.red}` },
          { label: "{b}", insertText: "{b}", replaceFrom: safeCursor, replaceTo: safeCursor, detail: "Make match bold", kind: "flag" },
          { label: "{z=yellow}", insertText: "{z=yellow}", replaceFrom: safeCursor, replaceTo: safeCursor, detail: "Highlight match yellow", kind: "flag", swatch: `#${SEDMAT_NAMED_COLORS.yellow}` },
          { label: "{!0 b c=blue}", insertText: "{!0 b c=blue}", replaceFrom: safeCursor, replaceTo: safeCursor, detail: "Add bold blue without resetting existing style", kind: "snippet", swatch: `#${SEDMAT_NAMED_COLORS.blue}` },
          { label: "$0", insertText: "$0", replaceFrom: safeCursor, replaceTo: safeCursor, detail: "Insert original matched text", kind: "value" },
        ],
      };
    }
    const trailing = afterS.slice(afterS.lastIndexOf("/") + 1);
    const trailingOpts = [
      { flag: "g", detail: "Global — replace every match" },
      { flag: "i", detail: "Case-insensitive regex match" },
      { flag: "m", detail: "Multiline ^ and $ anchors" },
      { flag: "2", detail: "Replace only the 2nd match" },
    ]
      .filter((o) => !trailing.includes(o.flag))
      .map<SedmatSuggestion>((o) => ({
        label: o.flag,
        insertText: o.flag,
        replaceFrom: safeCursor,
        replaceTo: safeCursor,
        detail: o.detail,
        kind: "flag",
      }));

    return {
      contextTitle: "Substitution — Trailing Flags",
      signature: [
        { text: "s/pattern/replacement/" },
        { text: "[g i m N]", active: true },
      ],
      suggestions: trailingOpts,
      ghostSuffix: computeGhostSuffix(input, safeCursor, trailingOpts),
    };
  }

  // 4. Default / Start of expression
  const q = seg.toLowerCase();
  const baseStarters: SedmatSnippetOption[] =
    profile === "slides"
      ? [
          { label: `@${containerNum}:title:s/.*/New Title/`, insert: `@${containerNum}:title:s/.*/`, detail: `Edit slide ${containerNum} title`, kind: "snippet" },
          { label: "s/old/{b c=blue t=new}/g", insert: "s/", detail: `Search & replace on slide ${containerNum}`, kind: "command" },
          { label: "@*:s/old/new/gi", insert: "@*:s/", detail: "Search & replace across ALL slides", kind: "snippet" },
          { label: `@${containerNum}:notes:a/Talking point/`, insert: `@${containerNum}:notes:a/`, detail: `Append speaker note on slide ${containerNum}`, kind: "snippet" },
          { label: "@$a/{layout=two-col}New Slide/", insert: "@$a/{layout=two-col}", detail: "Append a new slide", kind: "snippet" },
        ]
      : [
          { label: "s/old/new/g", insert: "s/", detail: "Search & replace across document", kind: "command" },
          { label: "s/TODO/{b c=red}/g", insert: "s/TODO/{b c=red}/g", detail: "Highlight every TODO in bold red", kind: "snippet" },
          { label: "1s/.*/{h=t}/", insert: "1s/.*/{h=t}/", detail: "Format element 1 as Title", kind: "snippet" },
          { label: "$a/{h=2}Next Steps/", insert: "$a/{h=2}", detail: "Append a new Heading 2 at end", kind: "snippet" },
          { label: "d/DRAFT/i", insert: "d/", detail: "Delete elements matching pattern", kind: "command" },
          { label: "s/{T=1!A1}/{b}Header/", insert: "s/{T=1!A1}/", detail: "Edit cell A1 of table 1", kind: "snippet" },
          { label: "@header:s/.*/CONFIDENTIAL/", insert: "@header:s/", detail: "Edit document header", kind: "scope" },
        ];

  const starters = [...(ctx.extensions?.starters ?? []), ...baseStarters];
  const filtered = starters
    .filter((s) => !q || s.label.toLowerCase().includes(q) || s.detail.toLowerCase().includes(q))
    .map<SedmatSuggestion>((s) => ({
      label: s.label,
      insertText: s.insert,
      replaceFrom: cmdStart,
      replaceTo: safeCursor,
      detail: s.detail,
      kind: s.kind,
      swatch: s.swatch,
    }));

  return {
    contextTitle: "SEDMAT v3.7",
    signature: [
      { text: "[@scope:][addr]", active: !seg },
      { text: "cmd/pattern/{flags}replacement/[g i m N]" },
    ],
    suggestions: filtered,
    ghostSuffix: computeGhostSuffix(input, safeCursor, filtered),
  };
}

/**
 * Lightweight, non-throwing syntax tokenizer for SEDMAT expressions.
 * Useful for syntax highlighting in web inputs, TUIs, CLIs, and LSP semantic tokens.
 */
export function tokenizeSedmat(input: string): SedmatToken[] {
  const tokens: SedmatToken[] = [];
  let i = 0;
  const len = input.length;

  const push = (kind: SedmatTokenKind, start: number, end: number) => {
    if (end > start) tokens.push({ kind, start, end, text: input.slice(start, end) });
  };

  while (i < len) {
    // Whitespace / command separators
    if (/\s/.test(input[i]!)) {
      const s = i;
      while (i < len && /\s/.test(input[i]!)) i++;
      push("whitespace", s, i);
      continue;
    }
    if (input[i] === ";") {
      push("delimiter", i, i + 1);
      i++;
      continue;
    }
    // Comment line
    if (input[i] === "#") {
      const s = i;
      const nl = input.indexOf("\n", i);
      i = nl >= 0 ? nl : len;
      push("comment", s, i);
      continue;
    }
    // Container scope `@...:` or `@3`
    if (input[i] === "@") {
      const s = i;
      i++;
      while (i < len && !/[\s;{\/]/.test(input[i]!)) {
        if (input[i] === '"') {
          i++;
          while (i < len && input[i] !== '"') i++;
          if (i < len) i++;
          continue;
        }
        if (input[i] === ":") {
          i++;
          // Check optional region `title:`, `notes:`, `shape=2:`
          const rem = input.slice(i);
          const reg = /^(?:title|sub|subtitle|body|notes|header|footer|shape=[1-9]\d*):/i.exec(rem);
          if (reg) i += reg[0].length;
          break;
        }
        if ((input[i] === "d" || input[i] === "a" || input[i] === "i") && (i + 1 >= len || /[\s;\/]/.test(input[i + 1]!))) {
          break;
        }
        i++;
      }
      push("scope", s, i);
      continue;
    }
    // Numeric / `$` address prefix
    if (input[i] === "$" || (input[i]! >= "0" && input[i]! <= "9")) {
      const s = i;
      while (i < len && /[\d,$!]/.test(input[i]!)) i++;
      push("address", s, i);
      continue;
    }
    // Brace block `{...}`
    if (input[i] === "{") {
      const s = i;
      let depth = 0;
      while (i < len) {
        if (input[i] === "\\" && i + 1 < len) { i += 2; continue; }
        if (input[i] === "{") depth++;
        else if (input[i] === "}") {
          depth--;
          i++;
          if (depth === 0) break;
          continue;
        }
        i++;
      }
      push("brace", s, i);
      continue;
    }
    // Commands: s, d, a, i, c, y
    if ("sdaciy".includes(input[i]!)) {
      const cmd = input[i]!;
      push("command", i, i + 1);
      i++;
      if (i < len && !/[\s;\n]/.test(input[i]!)) {
        const delim = input[i]!;
        push("delimiter", i, i + 1);
        i++;
        const expectedParts = cmd === "s" || cmd === "y" ? 2 : 1;
        for (let part = 0; part < expectedParts && i < len; part++) {
          let pStart = i;
          while (i < len && input[i] !== "\n") {
            if (input[i] === "\\" && i + 1 < len) { i += 2; continue; }
            if (input[i] === delim) break;
            if (part === 1 && input[i] === "{") {
              push("text", pStart, i);
              const bStart = i;
              let depth = 0;
              while (i < len && input[i] !== "\n") {
                if (input[i] === "\\" && i + 1 < len) { i += 2; continue; }
                if (input[i] === "{") depth++;
                else if (input[i] === "}") {
                  depth--;
                  i++;
                  if (depth === 0) break;
                  continue;
                }
                i++;
              }
              push("brace", bStart, i);
              pStart = i;
              continue;
            }
            i++;
          }
          if (i > pStart) {
            push(part === 0 ? "pattern" : "text", pStart, i);
          }
          if (i < len && input[i] === delim) {
            push("delimiter", i, i + 1);
            i++;
          }
        }
        // Trailing flags
        const fStart = i;
        while (i < len && /[gim0-9]/.test(input[i]!)) i++;
        push("flag", fStart, i);
      }
      continue;
    }

    // Fallback single char
    push("text", i, i + 1);
    i++;
  }

  return tokens;
}
