import type {
  Address,
  Command,
  ContainerScope,
  ContainerType,
  Expression,
  Program,
} from "./types.ts";
import {
  findMatchingBrace,
  hasBraceFormatting,
  mergeBraceSpans,
  parseBraceExpression,
  parseBraceReplacement,
} from "./brace.ts";
import {
  detectBraceReference,
  parseBraceTableReference,
  parseTableCellReference,
  parseTableReference,
} from "./references.ts";

const CONTAINER_TYPES = new Set<ContainerType>(["slide", "sheet", "tab", "page", "section"]);
const REGION_RE = /^(title|sub|subtitle|body|notes|header|footer|shape=[1-9]\d*)$/i;

export function parseAddress(raw: string): { address?: Address; rest: string } {
  if (!raw) return { rest: raw };
  const first = raw[0]!;
  if (first !== "$" && (first < "0" || first > "9")) {
    return { rest: raw };
  }

  let i = 0;
  let start = 0;
  if (raw[i] === "$") {
    start = -1;
    i++;
  } else {
    const startIdx = i;
    while (i < raw.length && raw[i]! >= "0" && raw[i]! <= "9") i++;
    start = Number.parseInt(raw.slice(startIdx, i), 10);
    if (start < 1) {
      throw new Error(`address must be >= 1, got ${start}`);
    }
  }

  let hasRange = false;
  let end = 0;
  if (i < raw.length && raw[i] === ",") {
    if (start === -1) {
      throw new Error("'$' cannot be used as range start");
    }
    hasRange = true;
    i++;
    if (i >= raw.length) {
      throw new Error("missing range end after ','");
    }
    if (raw[i] === "$") {
      end = -1;
      i++;
    } else if (raw[i]! >= "0" && raw[i]! <= "9") {
      const endIdx = i;
      while (i < raw.length && raw[i]! >= "0" && raw[i]! <= "9") i++;
      end = Number.parseInt(raw.slice(endIdx, i), 10);
      if (end < 1) {
        throw new Error(`address range end must be >= 1, got ${end}`);
      }
      if (end < start) {
        throw new Error(`address range ${start},${end} is reversed`);
      }
    } else {
      throw new Error(`invalid range end in address: ${raw}`);
    }
  }

  const rest = raw.slice(i);
  if (rest === "") {
    throw new Error(`address without command: ${raw}`);
  }
  return {
    address: { start, end, hasRange },
    rest,
  };
}

/**
 * Parses an optional SEDMAT v3.7 `@` container scope or container-op prefix.
 * Examples:
 * - `@3d`, `@2,4d`, `@$d`, `@$a/{layout=two-col}Next/`, `@3{move=1}`, `@2{dup}`
 * - `@2:s/old/new/g`, `@2,5:s/a/b/g`, `@*:s/DRAFT//g`
 * - `@Summary:3d`, `@"Q4 Budget":s/USD/EUR/g`
 * - `@slide=2:title:s/.* /New Title/`, `@header:s/DRAFT/FINAL/`
 */
export function parseContainerScope(raw: string): { container?: ContainerScope; rest: string } {
  if (!raw.startsWith("@")) {
    return { rest: raw };
  }
  let pos = 1;
  if (pos >= raw.length) {
    throw new Error("empty container scope '@'");
  }

  // Shorthand region without target: `@header:...` or `@footer:...`
  const bareRegion = /^(header|footer):(.*)$/i.exec(raw.slice(pos));
  if (bareRegion) {
    return {
      container: { region: bareRegion[1]!.toLowerCase(), containerOp: false },
      rest: bareRegion[2]!,
    };
  }

  let containerType: ContainerType | undefined;
  const typeMatch = /^([a-z]+)=/.exec(raw.slice(pos));
  if (typeMatch && CONTAINER_TYPES.has(typeMatch[1] as ContainerType)) {
    containerType = typeMatch[1] as ContainerType;
    pos += typeMatch[0].length;
  }

  let address: Address | undefined;
  let all = false;
  let name: string | undefined;

  if (raw[pos] === "*") {
    all = true;
    pos++;
  } else if (raw[pos] === '"') {
    const endQuote = raw.indexOf('"', pos + 1);
    if (endQuote < 0) {
      throw new Error(`unterminated quoted container name: ${raw}`);
    }
    name = raw.slice(pos + 1, endQuote);
    pos = endQuote + 1;
  } else if (raw[pos] === "$" || (raw[pos]! >= "0" && raw[pos]! <= "9")) {
    // Parse numeric/dollar container address without requiring immediate command
    const addrEnd = scanContainerAddress(raw, pos);
    const addrStr = raw.slice(pos, addrEnd);
    const parsed = parseAddress(`${addrStr}d`); // validate with dummy command
    address = parsed.address;
    pos = addrEnd;
  } else {
    const start = pos;
    while (pos < raw.length && /[A-Za-z0-9_-]/.test(raw[pos]!)) pos++;
    if (pos === start) {
      throw new Error(`invalid container target in ${raw}`);
    }
    name = raw.slice(start, pos);
  }

  if (pos >= raw.length) {
    throw new Error(`container scope without command: ${raw}`);
  }

  // Container-scoped edit (`@<target>:...` or `@<target>:<region>:...`)
  if (raw[pos] === ":") {
    pos++;
    let region: string | undefined;
    const colonIdx = raw.indexOf(":", pos);
    if (colonIdx > pos) {
      const candidate = raw.slice(pos, colonIdx);
      if (REGION_RE.test(candidate)) {
        region = candidate.toLowerCase();
        pos = colonIdx + 1;
      }
    }
    const rest = raw.slice(pos);
    if (!rest) {
      throw new Error(`container scope without command: ${raw}`);
    }
    return {
      container: { containerType, address, all: all || undefined, name, region, containerOp: false },
      rest,
    };
  }

  // Container-level operation (`@3d`, `@$a/.../`, `@2i/.../`, `@3{move=1}`, `@2{dup}`)
  const rest = raw.slice(pos);
  if (rest[0] === "d" || rest[0] === "a" || rest[0] === "i" || rest[0] === "{") {
    return {
      container: { containerType, address, all: all || undefined, name, containerOp: true },
      rest,
    };
  }

  throw new Error(`invalid container scope syntax: ${raw}`);
}

function scanContainerAddress(raw: string, startPos: number): number {
  let i = startPos;
  if (raw[i] === "$") {
    i++;
  } else {
    while (i < raw.length && raw[i]! >= "0" && raw[i]! <= "9") i++;
  }
  if (i < raw.length && raw[i] === ",") {
    i++;
    if (i < raw.length && raw[i] === "$") {
      i++;
    } else {
      while (i < raw.length && raw[i]! >= "0" && raw[i]! <= "9") i++;
    }
  }
  return i;
}

export function splitByDelimiter(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1]!;
      if (next === delimiter) {
        current += delimiter;
        i++;
        continue;
      }
      current += ch + next;
      i++;
      continue;
    }
    if (ch === delimiter) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

export function applyRegexFlags(pattern: string, flags: string): string {
  let result = pattern;
  if (flags.includes("i") && !result.startsWith("(?i)")) {
    result = `(?i)${result}`;
  }
  if (flags.includes("m") && !result.startsWith("(?m)")) {
    result = `(?m)${result}`;
  }
  return result;
}

export function nthFlag(flags: string): number {
  const m = /(\d+)/.exec(flags);
  if (!m) return 0;
  const n = Number.parseInt(m[1]!, 10);
  return n > 0 ? n : 0;
}

function isAlphanumeric(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

export function parseSubstitution(raw: string): Expression {
  if (raw.length < 4 || raw[0] !== "s") {
    throw new Error(`invalid substitution expression: ${raw}`);
  }
  const delim = raw[1]!;
  if (isAlphanumeric(delim) || delim === "\\") {
    throw new Error(`invalid substitution delimiter: ${delim}`);
  }
  const parts = splitByDelimiter(raw.slice(2), delim);
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(`malformed substitution expression: ${raw}`);
  }
  const rawPattern = parts[0]!;
  const replacement = parts[1]!;
  const flags = parts[2] ?? "";

  const pattern = applyRegexFlags(rawPattern, flags);
  return {
    command: "s",
    pattern,
    replacement,
    global: flags.includes("g"),
    nthMatch: nthFlag(flags),
    flags,
  };
}

export function parseDelete(raw: string, hasAddress: boolean): Expression {
  if (raw === "d") {
    if (!hasAddress) {
      throw new Error("delete command 'd' requires a pattern or address");
    }
    return { command: "d", pattern: "", replacement: "", global: false, nthMatch: 0, flags: "" };
  }
  if (raw.length < 3 || raw[0] !== "d") {
    throw new Error(`invalid delete expression: ${raw}`);
  }
  const delim = raw[1]!;
  if (isAlphanumeric(delim) || delim === "\\") {
    throw new Error(`invalid delete delimiter: ${delim}`);
  }
  const parts = splitByDelimiter(raw.slice(2), delim);
  if (parts.length < 2) {
    throw new Error(`malformed delete expression: ${raw}`);
  }
  const flags = parts[1] ?? "";
  return {
    command: "d",
    pattern: applyRegexFlags(parts[0]!, flags),
    replacement: "",
    global: flags.includes("g"),
    nthMatch: 0,
    flags,
  };
}

export function parseInsertAppend(raw: string, command: "a" | "i", hasAddress: boolean): Expression {
  if (raw.length < 3 || raw[0] !== command) {
    throw new Error(`invalid ${command} expression: ${raw}`);
  }
  const delim = raw[1]!;
  if (isAlphanumeric(delim) || delim === "\\") {
    throw new Error(`invalid ${command} delimiter: ${delim}`);
  }
  const parts = splitByDelimiter(raw.slice(2), delim);
  if (hasAddress) {
    if (parts.length < 2) {
      throw new Error(`malformed addressed ${command} expression: ${raw}`);
    }
    return {
      command,
      pattern: "",
      replacement: parts[0]!,
      global: false,
      nthMatch: 0,
      flags: parts[1] ?? "",
    };
  }
  if (parts.length < 3) {
    throw new Error(`malformed ${command} expression: ${raw}`);
  }
  const flags = parts[2] ?? "";
  return {
    command,
    pattern: applyRegexFlags(parts[0]!, flags),
    replacement: parts[1]!,
    global: flags.includes("g"),
    nthMatch: 0,
    flags,
  };
}

export function parseTransliterate(raw: string): Expression {
  if (raw.length < 4 || raw[0] !== "y") {
    throw new Error(`invalid transliterate expression: ${raw}`);
  }
  const delim = raw[1]!;
  if (isAlphanumeric(delim) || delim === "\\") {
    throw new Error(`invalid transliterate delimiter: ${delim}`);
  }
  const parts = splitByDelimiter(raw.slice(2), delim);
  if (parts.length < 3) {
    throw new Error(`malformed transliterate expression: ${raw}`);
  }
  const src = [...parts[0]!];
  const dst = [...parts[1]!];
  if (src.length !== dst.length) {
    throw new Error(`transliterate source length (${src.length}) != dest length (${dst.length})`);
  }
  return {
    command: "y",
    pattern: parts[0]!,
    replacement: parts[1]!,
    global: false,
    nthMatch: 0,
    flags: parts[2] ?? "",
  };
}

export function parseExpression(raw: string): Expression {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("empty expression");
  }

  const { container, rest: afterContainer } = parseContainerScope(trimmed);

  // Standalone brace expression under a container scope (`@1:{z=#0F172A}`, `@3{move=1}`, `@2{dup}`)
  if (container && afterContainer.startsWith("{")) {
    const closeIdx = findMatchingBrace(afterContainer, 0);
    if (closeIdx !== afterContainer.length - 1) {
      throw new Error(`malformed container brace expression: ${raw}`);
    }
    const brace = parseBraceExpression(afterContainer.slice(1, closeIdx));
    return {
      command: "brace",
      pattern: "",
      replacement: afterContainer,
      global: false,
      nthMatch: 0,
      flags: "",
      container,
      brace,
    };
  }

  let address: Address | undefined;
  let body = afterContainer;
  if (!container?.containerOp) {
    const parsedAddr = parseAddress(afterContainer);
    address = parsedAddr.address;
    body = parsedAddr.rest;
  }

  const hasAddr = Boolean(address) || Boolean(container);
  const cmd = body[0] as Command;
  let expr: Expression;
  switch (cmd) {
    case "s":
      expr = parseSubstitution(body);
      break;
    case "d":
      expr = parseDelete(body, hasAddr);
      break;
    case "a":
    case "i":
      expr = parseInsertAppend(body, cmd, hasAddr);
      break;
    case "y":
      expr = parseTransliterate(body);
      break;
    default:
      throw new Error(`unsupported command in expression: ${raw}`);
  }

  if (address) expr.address = address;
  if (container) expr.container = container;
  return expr;
}

export function parse(raw: string): Program {
  return { expressions: [parseExpression(raw)] };
}

export function enrich(program: Program): Program {
  return {
    expressions: program.expressions.map(enrichExpression),
  };
}

function enrichExpression(expression: Expression): Expression {
  if (expression.enriched || expression.command !== "s") {
    return expression;
  }
  const expr: Expression = { ...expression, enriched: true };

  if (!expr.cell) {
    const cell = parseTableCellReference(expr.pattern);
    if (cell) {
      expr.cell = cell;
      expr.pattern = cell.subpattern ?? "";
    }
  }

  if (!expr.cell && expr.pattern.startsWith("{")) {
    const detected = detectBraceReference(expr.pattern);
    expr.pattern = detected.remaining;
    if (detected.table) {
      expr.table = detected.table;
      if (detected.table.isCreate) {
        expr.tableCreate = {
          rows: detected.table.createRows ?? 0,
          columns: detected.table.createCols ?? 0,
          header: detected.table.hasHeader,
        };
      }
    }
    if (detected.image) {
      expr.image = detected.image;
    }
  }

  if (!expr.cell && !expr.table && !expr.image) {
    const table = parseTableReference(expr.pattern);
    if (table) {
      expr.table = table;
      expr.pattern = "";
    }
  }

  if (hasBraceFormatting(expr.replacement)) {
    const { cleaned, spans } = parseBraceReplacement(expr.replacement);
    if (spans.length > 0) {
      expr.replacement = cleaned;
      expr.braceSpans = spans;
      if (spans.length === 1 && spans[0]!.isGlobal) {
        expr.brace = spans[0]!.expr;
      } else {
        expr.brace = mergeBraceSpans(spans);
      }
      if (expr.brace?.tableRef) {
        try {
          const t = parseBraceTableReference(expr.brace.tableRef);
          if (t.isCreate) {
            expr.tableCreate = {
              rows: t.createRows ?? 0,
              columns: t.createCols ?? 0,
              header: t.hasHeader,
            };
            expr.brace = undefined;
            expr.braceSpans = undefined;
          }
        } catch {
          // Leave as-is if not a create spec
        }
      }
    }
  }

  return expr;
}

export function parseProgram(script: string): Program {
  const expressions: Expression[] = [];
  const lines = script.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      expressions.push(parseExpression(line));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`line ${i + 1}: ${msg}`);
    }
  }
  return enrich({ expressions });
}

export function parseExpressions(rawExprs: string[]): Program {
  const expressions: Expression[] = [];
  for (let i = 0; i < rawExprs.length; i++) {
    const line = rawExprs[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      expressions.push(parseExpression(line));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`expression ${i + 1}: ${msg}`);
    }
  }
  return enrich({ expressions });
}
