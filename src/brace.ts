import type { BraceExpression, BraceSpan } from "./types.ts";

const NAMED_COLORS: Record<string, string> = {
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  orange: "#FFA500",
  purple: "#800080",
  pink: "#FFC0CB",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  white: "#FFFFFF",
  black: "#000000",
  gray: "#808080",
  grey: "#808080",
  navy: "#000080",
  teal: "#008080",
  maroon: "#800000",
  olive: "#808000",
  silver: "#C0C0C0",
  lime: "#00FF00",
  aqua: "#00FFFF",
  brown: "#A52A2A",
  gold: "#FFD700",
  indigo: "#4B0082",
  violet: "#EE82EE",
  coral: "#FF7F50",
  crimson: "#DC143C",
  lightgray: "#D3D3D3",
  lightgrey: "#D3D3D3",
  darkgray: "#A9A9A9",
  darkgrey: "#A9A9A9",
  transparent: "transparent",
};

const BOOL_FLAG_MAP: Record<string, keyof BraceExpression> = {
  b: "bold",
  bold: "bold",
  i: "italic",
  italic: "italic",
  _: "underline",
  underline: "underline",
  "-": "strike",
  strike: "strike",
  "#": "code",
  code: "code",
  "^": "sup",
  sup: "sup",
  ",": "sub",
  sub: "sub",
  w: "smallCaps",
  smallcaps: "smallCaps",
};

const VALUE_KEY_PREFIXES = [
  "t=", "text=", "c=", "color=", "z=", "bg=", "f=", "font=",
  "s=", "size=", "u=", "url=", "h=", "heading=", "l=", "leading=",
  "a=", "align=", "o=", "opacity=", "n=", "indent=", "k=", "kerning=",
  "x=", "width=", "y=", "height=", "p=", "spacing=", "e=", "effect=",
  "cols=", "check=", "toc=", "img=", "T=", "@=", '"=',
  // v3.7 container/slide/shape flags
  "layout=", "zone=", "shape=", "fill=", "stroke=", "notes=", "transition=", "move=",
];

const BARE_KEYWORDS = new Set([
  "0", "!0", "+", "check", "toc", "dup", "hide",
  "f", "s", "c", "z", "h", "p", "t",
]);

export function resolveColor(value: string): string {
  const lower = value.trim().toLowerCase();
  if (NAMED_COLORS[lower]) {
    return NAMED_COLORS[lower];
  }
  if (/^#[0-9a-f]{3}$/i.test(lower)) {
    const h = lower.slice(1).toUpperCase();
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(lower)) {
    return lower.toUpperCase();
  }
  return value;
}

export function tokenizeBraceContent(s: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) {
        inQuote = false;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseBraceExpression(raw: string): BraceExpression {
  let s = raw.trim();
  const expr: BraceExpression = {};
  if (s === "") {
    return expr;
  }

  // Comment consumes everything after "=
  const commentIdx = s.indexOf('"=') ;
  if (commentIdx >= 0) {
    expr.comment = unquote(s.slice(commentIdx + 2).trim());
    s = s.slice(0, commentIdx).trim();
  }

  // Leading reset 0 (not !0)
  if (s === "0" || s.startsWith("0 ") || s.startsWith("0\t")) {
    expr.reset = true;
    s = s.slice(1).trim();
  }

  const tokens = tokenizeBraceContent(s);
  for (const tok of tokens) {
    if (tok === "+" || tok.startsWith("+=")) {
      expr.hasBreak = true;
      expr.breakKind = tok.startsWith("+=") ? tok.slice(2) : "";
      continue;
    }
    if (tok.startsWith("@=")) {
      expr.bookmark = unquote(tok.slice(2));
      continue;
    }
    if (tok === "0") {
      expr.reset = true;
      continue;
    }
    if (tok === "!0") {
      expr.noReset = true;
      continue;
    }
    if (tok.startsWith("!")) {
      const flag = tok.slice(1);
      const canon = BOOL_FLAG_MAP[flag];
      if (!canon) {
        throw new Error(`unknown negated flag: ${flag}`);
      }
      (expr as Record<string, unknown>)[canon] = false;
      continue;
    }

    const eqIdx = tok.indexOf("=");
    if (eqIdx >= 0) {
      const key = tok.slice(0, eqIdx);
      const val = unquote(tok.slice(eqIdx + 1));
      const boolCanon = BOOL_FLAG_MAP[key];
      if (boolCanon) {
        if (!expr.inlineSpans) expr.inlineSpans = [];
        expr.inlineSpans.push({ flag: boolCanon, text: val });
        continue;
      }
      parseKeyValue(key, val, expr);
      continue;
    }

    // Bare flag
    const boolCanon = BOOL_FLAG_MAP[tok];
    if (boolCanon) {
      (expr as Record<string, unknown>)[boolCanon] = true;
      continue;
    }
    switch (tok) {
      case "check":
        expr.check = false;
        break;
      case "toc":
        expr.hasToc = true;
        expr.toc = -1;
        break;
      case "h":
        expr.heading = "1";
        break;
      case "p":
        expr.spacingSet = true;
        expr.spacingAbove = 0;
        expr.spacingBelow = 0;
        break;
      case "dup":
        expr.dup = true;
        break;
      case "hide":
        expr.hide = true;
        break;
      case "t":
      case "f":
      case "s":
      case "c":
      case "z":
        // Bare reset/default markers
        break;
      default:
        throw new Error(`unknown brace flag: ${tok}`);
    }
  }

  return expr;
}

function parseKeyValue(key: string, val: string, expr: BraceExpression): void {
  switch (key) {
    case "t":
    case "text":
      expr.text = val;
      break;
    case "c":
    case "color":
      expr.color = resolveColor(val);
      break;
    case "z":
    case "bg":
      expr.bg = resolveColor(val);
      break;
    case "f":
    case "font":
      expr.font = val;
      break;
    case "s":
    case "size":
      expr.size = Number.parseFloat(val);
      break;
    case "u":
    case "url":
      expr.url = val;
      break;
    case "h":
    case "heading":
      expr.heading = val;
      break;
    case "l":
    case "leading":
      expr.leading = Number.parseFloat(val);
      break;
    case "a":
    case "align":
      expr.align = val;
      break;
    case "o":
    case "opacity":
      expr.opacity = Number.parseFloat(val);
      break;
    case "n":
    case "indent":
      expr.indent = Number.parseInt(val, 10);
      break;
    case "k":
    case "kerning":
      expr.kerning = Number.parseFloat(val);
      break;
    case "x":
    case "width":
      expr.width = Number.parseFloat(val);
      break;
    case "y":
    case "height":
      expr.height = Number.parseFloat(val);
      break;
    case "p":
    case "spacing": {
      expr.spacingSet = true;
      const parts = val.split(",");
      expr.spacingAbove = Number.parseFloat(parts[0] ?? "0");
      expr.spacingBelow = Number.parseFloat(parts[1] ?? parts[0] ?? "0");
      break;
    }
    case "e":
    case "effect":
      expr.effect = val;
      break;
    case "cols":
      expr.cols = Number.parseInt(val, 10);
      break;
    case "check":
      expr.check = val === "y" || val === "true" || val === "1";
      break;
    case "toc":
      expr.hasToc = true;
      expr.toc = Number.parseInt(val, 10);
      break;
    case "img":
      expr.imgRef = val;
      break;
    case "T":
      expr.tableRef = val;
      break;
    // v3.7 Slide & Shape flags
    case "layout":
      expr.layout = val;
      break;
    case "zone":
      expr.zone = val;
      break;
    case "shape":
      expr.shape = val;
      break;
    case "fill":
      expr.fill = resolveColor(val);
      break;
    case "stroke":
      expr.stroke = resolveColor(val);
      break;
    case "notes":
      expr.notes = val;
      break;
    case "transition":
      expr.transition = val;
      break;
    case "move":
      expr.move = Number.parseInt(val, 10);
      break;
    default:
      throw new Error(`unknown brace key: ${key}`);
  }
}

export function findMatchingBrace(s: string, openIdx: number): number {
  // Comment syntax {"=...} uses a literal leading double-quote, not a quoted string.
  if (s.slice(openIdx + 1, openIdx + 3) === '"=') {
    return s.indexOf("}", openIdx + 3);
  }
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i]!;
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function looksLikeBraceExpression(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === "") return false;
  if (BARE_KEYWORDS.has(trimmed)) return true;
  const firstTok = trimmed.split(/\s+/)[0] ?? "";
  if (BARE_KEYWORDS.has(firstTok)) return true;
  if (BOOL_FLAG_MAP[firstTok]) return true;
  if (firstTok.startsWith("!") && BOOL_FLAG_MAP[firstTok.slice(1)]) return true;
  if (trimmed.startsWith("+=")) return true;
  for (const prefix of VALUE_KEY_PREFIXES) {
    if (trimmed.includes(prefix)) return true;
  }
  for (const flag of Object.keys(BOOL_FLAG_MAP)) {
    if (trimmed.startsWith(`${flag}=`)) return true;
  }
  return false;
}

export function hasBraceFormatting(replacement: string): boolean {
  for (let i = 0; i < replacement.length; i++) {
    if (replacement[i] === "\\" && i + 1 < replacement.length) {
      i++;
      continue;
    }
    if (replacement[i] === "{" && (i === 0 || replacement[i - 1] !== "$")) {
      const closeIdx = findMatchingBrace(replacement, i);
      if (closeIdx > i) {
        const inner = replacement.slice(i + 1, closeIdx);
        if (looksLikeBraceExpression(inner)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function braceExpressionHasAnyFormat(expr: BraceExpression | undefined): boolean {
  if (!expr) return false;
  return Boolean(
    expr.bold !== undefined ||
      expr.italic !== undefined ||
      expr.underline !== undefined ||
      expr.strike !== undefined ||
      expr.code !== undefined ||
      expr.sup !== undefined ||
      expr.sub !== undefined ||
      expr.smallCaps !== undefined ||
      (expr.inlineSpans && expr.inlineSpans.length > 0) ||
      expr.text ||
      expr.color ||
      expr.bg ||
      expr.font ||
      (expr.size !== undefined && expr.size > 0) ||
      expr.url ||
      expr.heading ||
      (expr.leading !== undefined && expr.leading > 0) ||
      expr.align ||
      (expr.opacity !== undefined && expr.opacity > 0) ||
      expr.indent !== undefined ||
      (expr.kerning !== undefined && expr.kerning !== 0) ||
      (expr.width !== undefined && expr.width > 0) ||
      (expr.height !== undefined && expr.height > 0) ||
      expr.spacingSet ||
      expr.effect ||
      (expr.cols !== undefined && expr.cols > 0) ||
      expr.reset ||
      expr.noReset ||
      expr.hasBreak ||
      expr.comment ||
      expr.bookmark ||
      expr.check !== undefined ||
      expr.hasToc ||
      expr.imgRef ||
      expr.tableRef ||
      expr.layout ||
      expr.zone ||
      expr.shape ||
      expr.fill ||
      expr.stroke ||
      expr.notes ||
      expr.transition ||
      expr.move !== undefined ||
      expr.dup ||
      expr.hide,
  );
}

export function parseBraceReplacement(replacement: string): { cleaned: string; spans: BraceSpan[] } {
  if (!replacement.includes("{")) {
    return { cleaned: replacement, spans: [] };
  }

  const spans: BraceSpan[] = [];
  let cleaned = "";
  let i = 0;

  while (i < replacement.length) {
    if (replacement[i] === "\\" && i + 1 < replacement.length) {
      const next = replacement[i + 1]!;
      if (next === "{" || next === "}") {
        cleaned += next;
        i += 2;
        continue;
      }
      cleaned += replacement[i];
      i++;
      continue;
    }

    if (replacement[i] === "{" && (i === 0 || replacement[i - 1] !== "$")) {
      const closeIdx = findMatchingBrace(replacement, i);
      if (closeIdx > i) {
        const inner = replacement.slice(i + 1, closeIdx);
        if (looksLikeBraceExpression(inner)) {
          try {
            const parsed = parseBraceExpression(inner);
            if (braceExpressionHasAnyFormat(parsed)) {
              const rawBraces = replacement.slice(i, closeIdx + 1);
              if (parsed.inlineSpans && parsed.inlineSpans.length > 0) {
                for (const inline of parsed.inlineSpans) {
                  const start = cleaned.length;
                  cleaned += inline.text;
                  const end = cleaned.length;
                  const spanExpr: BraceExpression = { ...parsed, inlineSpans: undefined };
                  (spanExpr as Record<string, unknown>)[inline.flag] = true;
                  spans.push({ start, end, isGlobal: false, expr: spanExpr, raw: rawBraces });
                }
              } else {
                const start = cleaned.length;
                if (parsed.text) {
                  cleaned += parsed.text;
                }
                const end = cleaned.length;
                const isGlobal = i === 0 || closeIdx === replacement.length - 1;
                spans.push({ start, end, isGlobal, expr: parsed, raw: rawBraces });
              }
              i = closeIdx + 1;
              continue;
            }
          } catch {
            // Fall through and treat as literal braces
          }
        }
      }
    }

    cleaned += replacement[i];
    i++;
  }

  return { cleaned, spans };
}

export function mergeBraceSpans(spans: BraceSpan[]): BraceExpression {
  const merged: BraceExpression = {};
  for (const span of spans) {
    if (!span.isGlobal) continue;
    const src = span.expr;
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined && v !== "" && v !== false) {
        (merged as Record<string, unknown>)[k] = v;
      } else if (typeof v === "boolean" && v === false && k !== "reset" && k !== "noReset" && k !== "hasBreak" && k !== "hasToc") {
        (merged as Record<string, unknown>)[k] = false;
      }
    }
  }
  return merged;
}
