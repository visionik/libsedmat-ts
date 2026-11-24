/**
 * SEDMAT v3.6 Canonical Brace Syntax (`{flags}`) parser, flexible brace
 * placement resolver, and back-reference expander.
 *
 * Spec: https://github.com/visionik/sedmat (v3.6)
 */

import { resolveSedmatColor } from "./colors.js";
import { parseImageSpec, parseTableSpec, parseUriTarget } from "./references.js";
import {
  HeadingStyle,
  SedmatFormatFlags,
  SedmatReplacementSegment,
  SedmatStyledSpan,
} from "./types.js";

/**
 * Tokenize the body inside `{...}` on whitespace, respecting:
 * - Quoted values (`t="hello world"`, `f='Times New Roman'`)
 * - Unquoted comment syntax (`"=Review this section` captures spaces to end of brace)
 * - Commas preserved inside tokens (needed for `{,}`, `{,=2}`, `{p=12,6}`, `{T=1!1,2}`)
 */
export function tokenizeBraceBody(body: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = body.length;

  while (i < len) {
    while (i < len && /\s/.test(body[i]!)) i++;
    if (i >= len) break;

    // Special case: comment flag `"=comment text` (ABNF allows spaces in comment-text)
    if (body[i] === '"' && body[i + 1] === "=") {
      let rest = body.slice(i + 2).trim();
      if (
        rest.length >= 2 &&
        ((rest.startsWith('"') && rest.endsWith('"')) ||
          (rest.startsWith("'") && rest.endsWith("'")))
      ) {
        rest = rest.slice(1, -1);
      } else if (rest.endsWith('"') && !rest.slice(0, -1).includes('"')) {
        rest = rest.slice(0, -1);
      }
      tokens.push(`"=${rest}`);
      break;
    }

    let cur = "";
    let quote: '"' | "'" | null = null;
    while (i < len) {
      const ch = body[i]!;
      if (quote) {
        if (ch === "\\" && i + 1 < len) {
          cur += body[++i]!;
        } else if (ch === quote) {
          quote = null;
        } else {
          cur += ch;
        }
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i++;
        continue;
      }
      if (/\s/.test(ch)) {
        break;
      }
      cur += ch;
      i++;
    }
    if (cur.length > 0) tokens.push(cur);
  }

  return tokens;
}

function parseHeadingValue(val: string): HeadingStyle | null {
  const lv = val.toLowerCase();
  if (lv === "0" || lv === "normal" || lv === "p") return "Normal";
  if (lv === "t" || lv === "title") return "Title";
  if (lv === "s" || lv === "subtitle") return "Subtitle";
  if (lv === "1" || lv === "h1") return "Heading1";
  if (lv === "2" || lv === "h2") return "Heading2";
  if (lv === "3" || lv === "h3") return "Heading3";
  if (lv === "4" || lv === "h4") return "Heading4";
  if (lv === "5" || lv === "h5") return "Heading5";
  if (lv === "6" || lv === "h6") return "Heading6";
  return null;
}

/**
 * Parse a SEDMAT v3.6 `{flags}` block body into structured `SedmatFormatFlags`.
 */
export function parseBraceFlags(body: string): SedmatFormatFlags {
  const flags: SedmatFormatFlags = {};
  const tokens = tokenizeBraceBody(body);

  for (const rawTok of tokens) {
    // 1. Comment flag: `{"=comment text}`
    if (rawTok.startsWith('"="') || rawTok.startsWith('"=') ) {
      flags.comment = rawTok.slice(2);
      continue;
    }

    // 2. Bookmark flag: `{@=name}`
    if (rawTok.startsWith("@=")) {
      flags.bookmark = rawTok.slice(2);
      continue;
    }

    const eqIdx = rawTok.indexOf("=");
    if (eqIdx === -1) {
      // Bare token: reset `{0}`, additive no-reset `{!0}`, break `{+}`, `{check}`, `{toc}`, boolean toggle / negation (`!b`), or bare value reset
      if (rawTok === "0") {
        flags.reset = true;
        continue;
      }
      if (rawTok === "!0") {
        flags.noReset = true;
        continue;
      }
      if (rawTok === "+") {
        flags.break = "hr";
        continue;
      }

      const negated = rawTok.startsWith("!");
      const key = (negated ? rawTok.slice(1) : rawTok).toLowerCase();
      const boolVal = !negated;

      switch (key) {
        // Canonical SEDMAT v3.6 boolean flags
        case "b":
        case "bold":
          flags.bold = boolVal;
          break;
        case "i":
        case "italic":
          flags.italic = boolVal;
          break;
        case "_":
        case "underline":
          flags.underline = boolVal;
          break;
        case "-":
        case "~":
        case "strike":
          flags.strike = boolVal;
          break;
        case "#":
        case "code":
        case "mono":
          flags.code = boolVal;
          break;
        case "^":
        case "sup":
        case "superscript":
          flags.superscript = boolVal;
          break;
        case ",":
        case "sub":
        case "subscript":
          flags.subscript = boolVal;
          break;
        case "w":
        case "smallcaps":
          flags.smallCaps = boolVal;
          break;

        // Special bare flags
        case "check":
          flags.checkbox = negated ? null : "unchecked";
          break;
        case "toc":
          flags.toc = {};
          break;
        case "h":
        case "heading":
          // Per SEDMAT v3.6 spec: bare `{h}` defaults to Heading 1; `{h=0}` resets to Normal.
          flags.heading = negated ? "Normal" : "Heading1";
          break;
        case "t":
        case "text":
          // Bare `{t}` explicitly keeps implicit `$0`
          flags.text = "$0";
          break;
        case "q":
        case "quote":
          flags.quote = boolVal;
          break;
        case "reset":
        case "clear":
        case "plain":
          flags.reset = true;
          break;

        // Bare value flags reset back to document defaults (v3.6 rule 3)
        case "c":
        case "color":
          flags.color = null;
          break;
        case "z":
        case "bg":
        case "hl":
        case "highlight":
          flags.bg = null;
          break;
        case "f":
        case "font":
          flags.fontFamily = null;
          break;
        case "s":
        case "sz":
        case "size":
          flags.fontSizePt = null;
          break;
        case "u":
        case "url":
        case "link":
          flags.url = null;
          flags.uri = null;
          break;
        case "l":
        case "leading":
          flags.leadingPt = null;
          break;
        case "a":
        case "align":
          flags.align = null;
          break;
        case "o":
        case "opacity":
          flags.opacity = null;
          break;
        case "n":
        case "indent":
          flags.indentPt = null;
          break;
        case "k":
        case "kerning":
          flags.kerningPt = null;
          break;
        case "x":
        case "width":
          flags.width = null;
          break;
        case "y":
        case "height":
          flags.height = null;
          break;
        case "p":
        case "spacing":
          flags.spacing = null;
          break;
        case "e":
        case "effect":
          flags.effect = null;
          break;
        case "cols":
          flags.cols = 1;
          break;
        case "list":
          flags.list = "none";
          break;

        // Container / slide structural bare toggles (v3.7)
        case "dup":
        case "duplicate":
          flags.dup = boolVal;
          break;
        case "hide":
        case "hidden":
          flags.hide = boolVal;
          break;
        case "fill":
          flags.fill = null;
          break;
        case "stroke":
          flags.stroke = null;
          break;
      }
      continue;
    }

    // Key=Value token (preserve case for key `T` vs `t`!)
    const rawKey = rawTok.slice(0, eqIdx);
    const key = rawKey.toLowerCase();
    const val = rawTok.slice(eqIdx + 1);

    // Table spec uses uppercase `T=`
    if (rawKey === "T") {
      const table = parseTableSpec(val);
      if (table) flags.table = table;
      continue;
    }

    switch (key) {
      // Inline scoping for canonical boolean flags (`{b=text}`, `{^=2}`, `{,=2}`, etc.)
      case "b":
      case "bold":
        flags.bold = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case "i":
      case "italic":
        flags.italic = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case "_":
      case "underline":
        flags.underline = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case "-":
      case "~":
      case "strike":
        flags.strike = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case "#":
      case "code":
      case "mono":
        flags.code = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case "^":
      case "sup":
      case "superscript":
        flags.superscript = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case ",":
      case "sub":
      case "subscript":
        flags.subscript = true;
        flags.text = val;
        flags.inlineScoped = true;
        break;
      case "w":
      case "smallcaps":
        if (key === "w" && /^\d+(?:\.\d+)?(?:in|px|%|pt)$/i.test(val)) {
          flags.geomW = val;
        } else {
          flags.smallCaps = true;
          flags.text = val;
          flags.inlineScoped = true;
        }
        break;

      // Breaks (`+=p`, `+=c`, `+=s`)
      case "+": {
        const bv = val.toLowerCase();
        if (bv === "p" || bv === "page") flags.break = "page";
        else if (bv === "c" || bv === "col" || bv === "column") flags.break = "column";
        else if (bv === "s" || bv === "sec" || bv === "section") flags.break = "section";
        else flags.break = "hr";
        break;
      }

      // Checkboxes (`check=y`, `check=n`)
      case "check": {
        const cv = val.toLowerCase();
        if (cv === "y" || cv === "true" || cv === "1" || cv === "x") {
          flags.checkbox = "checked";
        } else if (cv === "n" || cv === "false" || cv === "0" || cv === "") {
          flags.checkbox = "unchecked";
        }
        break;
      }

      // Table of contents (`toc=2`)
      case "toc": {
        const depth = Number.parseInt(val, 10);
        flags.toc = Number.isFinite(depth) && depth >= 1 ? { maxDepth: depth } : {};
        break;
      }

      // Columns (`cols=2`)
      case "cols": {
        const cols = Number.parseInt(val, 10);
        flags.cols = Number.isFinite(cols) && cols >= 1 ? cols : null;
        break;
      }

      // Image (`img=...`)
      case "img": {
        const img = parseImageSpec(val);
        if (img) flags.image = img;
        break;
      }

      // Text override (`t=text`)
      case "t":
      case "text":
        flags.text = val;
        break;

      // Color & background (`c=`, `z=` / `bg=`)
      case "c":
      case "color":
        flags.color = val ? resolveSedmatColor(val) : null;
        break;
      case "z":
      case "bg":
      case "hl":
      case "highlight":
        flags.bg = val ? resolveSedmatColor(val) : null;
        break;

      // Font family (`f=Playfair+Display` or `f="Times New Roman"`)
      case "f":
      case "font":
        flags.fontFamily = val ? val.replace(/\+/g, " ") : null;
        break;

      // Font size (`s=14`, `size=14`)
      case "s":
      case "sz":
      case "size": {
        const pt = Number.parseFloat(val);
        flags.fontSizePt = Number.isFinite(pt) && pt > 0 ? pt : null;
        break;
      }

      // Hyperlink / bookmark / smart chip (`u=https://...`, `u=#ch1`, `u=chip://...`)
      case "u":
      case "url":
      case "link":
        flags.url = val || null;
        flags.uri = val ? parseUriTarget(val) : null;
        break;

      // Heading (`h=t`, `h=s`, `h=0`..`h=6`) or unit-aware box height (`h=2in`, `h=30%`)
      case "h":
      case "heading": {
        if (key === "h" && /^\d+(?:\.\d+)?(?:in|px|%|pt)$/i.test(val)) {
          flags.geomH = val;
        } else {
          const parsed = parseHeadingValue(val);
          if (parsed) flags.heading = parsed;
        }
        break;
      }

      // Alignment (`a=left|center|right|justify`)
      case "a":
      case "align":
      case "jc": {
        const av = val.toLowerCase();
        if (av === "left" || av === "center" || av === "right" || av === "justify") {
          flags.align = av;
        }
        break;
      }

      // Line spacing (`l=18`)
      case "l":
      case "leading": {
        const pt = Number.parseFloat(val);
        flags.leadingPt = Number.isFinite(pt) && pt > 0 ? pt : null;
        break;
      }

      // Opacity (`o=50`)
      case "o":
      case "opacity": {
        const pct = Number.parseFloat(val);
        flags.opacity = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
        break;
      }

      // Indent (`n=36`)
      case "n":
      case "indent": {
        const pt = Number.parseFloat(val);
        flags.indentPt = Number.isFinite(pt) && pt >= 0 ? pt : null;
        break;
      }

      // Kerning (`k=1.5`)
      case "k":
      case "kerning": {
        const pt = Number.parseFloat(val);
        flags.kerningPt = Number.isFinite(pt) ? pt : null;
        break;
      }

      // Image dimensions (`x=400`, `y=200`) or unit-aware slide geometry (`x=1in`, `y=20%`)
      case "x":
      case "width": {
        if (/^\d+(?:\.\d+)?(?:in|px|%|pt)$/i.test(val)) {
          flags.geomX = val;
        }
        const n = Number.parseFloat(val);
        flags.width = Number.isFinite(n) && n > 0 ? n : null;
        break;
      }
      case "y":
      case "height": {
        if (/^\d+(?:\.\d+)?(?:in|px|%|pt)$/i.test(val)) {
          flags.geomY = val;
        }
        const n = Number.parseFloat(val);
        flags.height = Number.isFinite(n) && n > 0 ? n : null;
        break;
      }
      case "left":
        flags.geomX = val;
        break;
      case "top":
        flags.geomY = val;
        break;
      case "boxw":
        flags.geomW = val;
        break;
      case "boxh":
        flags.geomH = val;
        break;

      // Paragraph spacing (`p=12` or `p=12,6`)
      case "p":
      case "spacing": {
        const parts = val.split(",");
        const before = Number.parseFloat(parts[0] ?? "");
        const after = parts.length > 1 ? Number.parseFloat(parts[1] ?? "") : before;
        if (Number.isFinite(before) && Number.isFinite(after) && before >= 0 && after >= 0) {
          flags.spacing = { beforePt: before, afterPt: after };
        }
        break;
      }

      // Text effect (`e=shadow`)
      case "e":
      case "effect":
        flags.effect = val || null;
        break;

      // List convenience (`list=bullet|ordered|none`)
      case "list": {
        const lv = val.toLowerCase();
        if (lv === "bullet" || lv === "ul") flags.list = "bullet";
        else if (lv === "ordered" || lv === "ol" || lv === "num") flags.list = "ordered";
        else if (lv === "none") flags.list = "none";
        break;
      }

      // Slide / container / shape flags (SEDMAT v3.7)
      case "layout":
        if (val) flags.layout = val.toLowerCase();
        break;
      case "zone": {
        const zv = val.toLowerCase();
        if (
          zv === "left" ||
          zv === "right" ||
          zv === "top" ||
          zv === "bottom" ||
          zv === "center" ||
          zv === "footer"
        ) {
          flags.zone = zv;
        }
        break;
      }
      case "shape":
        if (val) flags.shape = val;
        break;
      case "fill":
        flags.fill = val ? resolveSedmatColor(val) : null;
        break;
      case "stroke":
        flags.stroke = val ? resolveSedmatColor(val) : null;
        break;
      case "notes":
        flags.notes = val;
        break;
      case "transition": {
        const tv = val.toLowerCase();
        if (tv === "none" || tv === "fade" || tv === "push" || tv === "wipe") {
          flags.transition = tv;
        }
        break;
      }
      case "move": {
        const dest = Number.parseInt(val, 10);
        if (Number.isFinite(dest) && dest >= 1) flags.move = dest;
        break;
      }
    }
  }

  return flags;
}

/**
 * Split a SEDMAT replacement string into ordered plain-text and `{flags}` brace segments.
 * Escaped braces `\{` and `\}` are treated as literal characters.
 */
export function parseReplacementSegments(replacement: string): SedmatReplacementSegment[] {
  const segments: SedmatReplacementSegment[] = [];
  let buf = "";
  let i = 0;

  const flushText = (): void => {
    if (buf.length > 0) {
      segments.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  while (i < replacement.length) {
    const ch = replacement[i]!;
    if (ch === "\\" && i + 1 < replacement.length) {
      const next = replacement[i + 1]!;
      if (next === "{" || next === "}" || next === "\\") {
        buf += next;
        i += 2;
        continue;
      }
      if (next === "n") {
        buf += "\n";
        i += 2;
        continue;
      }
      if (next === "t") {
        buf += "\t";
        i += 2;
        continue;
      }
      buf += ch + next;
      i += 2;
      continue;
    }

    if (ch === "{") {
      // Scan to matching '}' respecting quotes, while recognizing comment flags `"=...`
      let j = i + 1;
      let quote: '"' | "'" | null = null;
      while (j < replacement.length) {
        const c = replacement[j]!;
        if (quote) {
          if (c === "\\" && j + 1 < replacement.length) j += 2;
          else if (c === quote) {
            quote = null;
            j++;
          } else j++;
        } else if (
          c === '"' &&
          replacement[j + 1] === "=" &&
          (j === i + 1 || /\s/.test(replacement[j - 1]!))
        ) {
          // Comment flag `"=...` runs to closing `}` (unless `"="..."` quoted value)
          if (replacement[j + 2] === '"') {
            quote = '"';
            j += 3;
          } else {
            const closeIdx = replacement.indexOf("}", j + 2);
            j = closeIdx === -1 ? replacement.length : closeIdx;
            break;
          }
        } else if (c === '"' || c === "'") {
          quote = c;
          j++;
        } else if (c === "}") {
          break;
        } else {
          j++;
        }
      }

      if (j < replacement.length && replacement[j] === "}") {
        flushText();
        const body = replacement.slice(i + 1, j);
        segments.push({ kind: "brace", flags: parseBraceFlags(body) });
        i = j + 1;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flushText();
  return segments;
}

/** Merge two `SedmatFormatFlags` objects (later fields override earlier ones). */
export function mergeFormatFlags(
  a?: SedmatFormatFlags,
  b?: SedmatFormatFlags,
): SedmatFormatFlags | undefined {
  if (!a && !b) return undefined;
  return { ...(a ?? {}), ...(b ?? {}) };
}

function isSelfContainedBrace(flags: SedmatFormatFlags): boolean {
  return (
    flags.text !== undefined ||
    flags.inlineScoped === true ||
    flags.break !== undefined ||
    flags.toc !== undefined ||
    flags.table !== undefined ||
    flags.image !== undefined
  );
}

/**
 * Resolve raw replacement segments into canonical styled spans according to
 * SEDMAT v3.6 flexible brace placement rules:
 * - Standalone `{b}` -> `[{ text: "$0", implicitMatchText: true, flags: { bold: true } }]`
 * - Leading `{b}hello` -> `[{ text: "hello", flags: { bold: true } }]`
 * - Trailing `hello{b}` -> `[{ text: "hello", flags: { bold: true } }]`
 * - Surrounding `{c=red}warning{b}` -> `[{ text: "warning", flags: { color: "DC2626", bold: true } }]`
 * - Inline scoped `H{,=2}O` -> `["H", { text: "2", subscript: true }, "O"]`
 * - Multi-span `{b}Hello {i}world` -> `[{ text: "Hello ", bold: true }, { text: "world", italic: true }]`
 */
export function resolveReplacementSpans(
  segments: readonly SedmatReplacementSegment[],
): SedmatStyledSpan[] {
  if (segments.length === 0) return [];

  const hasTextSegment = segments.some((s) => s.kind === "text" && (s.text ?? "").length > 0);
  const hasSelfContained = segments.some(
    (s) => s.kind === "brace" && s.flags && isSelfContainedBrace(s.flags),
  );

  // Pure modifier braces with no text (e.g. `{b}` or `{b}{c=red}`): implicit `$0`
  if (!hasTextSegment && !hasSelfContained) {
    let merged: SedmatFormatFlags = {};
    for (const seg of segments) {
      if (seg.kind === "brace" && seg.flags) {
        merged = { ...merged, ...seg.flags };
      }
    }
    return [{ text: "$0", implicitMatchText: true, flags: merged }];
  }

  const spans: SedmatStyledSpan[] = [];
  let pendingFlags: SedmatFormatFlags | undefined;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.kind === "text") {
      const text = seg.text ?? "";
      if (text.length === 0) continue;
      spans.push({
        text,
        flags: pendingFlags ? { ...pendingFlags } : undefined,
      });
      pendingFlags = undefined;
      continue;
    }

    const flags = seg.flags ?? {};
    if (isSelfContainedBrace(flags)) {
      const combined = mergeFormatFlags(pendingFlags, flags);
      pendingFlags = undefined;
      spans.push({
        text: flags.text ?? "",
        flags: combined,
      });
      continue;
    }

    // Modifier brace (no explicit text):
    // If no text segment follows later, attach/merge onto the immediately preceding span (trailing brace e.g. `hello{b}` or `{c=red}warning{b}`).
    const hasFollowingText = segments.slice(i + 1).some((s) => s.kind === "text");
    if (!hasFollowingText && spans.length > 0) {
      const prev = spans[spans.length - 1]!;
      prev.flags = mergeFormatFlags(prev.flags, flags);
    } else {
      pendingFlags = mergeFormatFlags(pendingFlags, flags);
    }
  }

  if (pendingFlags) {
    spans.push({ text: "$0", implicitMatchText: true, flags: pendingFlags });
  }

  return spans;
}

/**
 * Expand SEDMAT back-references in a template string:
 * - `$$` -> literal `$`
 * - `\&` -> literal `&`
 * - `$0` or `&` -> full match (`match[0]`)
 * - `$1`–`$9`, `${1}`–`${9}`, `\1`–`\9` -> capture group
 */
export function expandBackrefs(template: string, match: RegExpExecArray): string {
  let out = "";
  let i = 0;
  const len = template.length;

  while (i < len) {
    const ch = template[i]!;

    if (ch === "\\" && i + 1 < len) {
      const next = template[i + 1]!;
      if (next === "&") {
        out += "&";
        i += 2;
        continue;
      }
      if (next === "$") {
        out += "$";
        i += 2;
        continue;
      }
      if (next >= "0" && next <= "9") {
        const idx = Number.parseInt(next, 10);
        out += idx < match.length ? (match[idx] ?? "") : template.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += ch + next;
      i += 2;
      continue;
    }

    if (ch === "$") {
      if (i + 1 < len && template[i + 1] === "$") {
        out += "$";
        i += 2;
        continue;
      }
      if (i + 1 < len && template[i + 1] === "{") {
        const close = template.indexOf("}", i + 2);
        if (close !== -1) {
          const inner = template.slice(i + 2, close);
          if (/^\d+$/.test(inner)) {
            const idx = Number.parseInt(inner, 10);
            out += idx < match.length ? (match[idx] ?? "") : template.slice(i, close + 1);
            i = close + 1;
            continue;
          }
        }
      }
      if (i + 1 < len && template[i + 1]! >= "0" && template[i + 1]! <= "9") {
        const idx = Number.parseInt(template[i + 1]!, 10);
        out += idx < match.length ? (match[idx] ?? "") : template.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += "$";
      i++;
      continue;
    }

    if (ch === "&") {
      out += match[0] ?? "";
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}
