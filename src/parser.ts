/**
 * SEDMAT v3.6 Expression & Program Parser.
 *
 * Supports:
 * - Classic `sed` 1-based addressing: `N`, `N,M`, `$`, `N,$`, `/re/`, `/a/,/b/`, `!`
 * - Strict v3.6 address validation (`$,N`, reversed ranges, `0`, address without command)
 * - Commands: `s`, `d`, `a`, `i`, `c`, `y` (both addressed and pattern forms)
 * - Flags: `g`, `i` (case-insensitive), `m` (multiline), positive integer `N` (nth occurrence)
 * - Any ASCII punctuation delimiter (`/`, `#`, `|`, etc.) with `\` escaping
 * - Positional insert patterns (`^$`, `^`, `$`)
 * - Table (`{T=...}`, `|N|[...]`) and Image (`{img=...}`, `!(...)`) targets
 *
 * Spec: https://github.com/visionik/sedmat (v3.6)
 */

import { parseBraceFlags, parseReplacementSegments } from "./brace.js";
import { parseImagePattern, parseTablePattern } from "./references.js";
import {
  ContainerTarget,
  ContainerType,
  PositionalPattern,
  SedmatAddress,
  SedmatAddressPoint,
  SedmatCommand,
  SedmatContainerScope,
  SedmatParseError,
  SedmatProgram,
  TableSpec,
} from "./types.js";

const REGION_ONLY_NAMES = new Set(["header", "footer", "title", "sub", "subtitle", "body", "notes"]);

function isAlphanumeric(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

/**
 * Read a delimited string starting after the opening delimiter, honoring `\<delim>` escapes.
 * Returns the captured raw content and the index immediately AFTER the closing delimiter.
 */
function readDelimited(
  src: string,
  start: number,
  delim: string,
  contextLabel?: string,
  hint?: string,
): { value: string; nextPos: number } {
  let out = "";
  let i = start;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length) {
      const next = src[i + 1]!;
      if (next === delim) {
        out += delim;
      } else {
        out += ch + next;
      }
      i += 2;
      continue;
    }
    if (ch === delim) {
      return { value: out, nextPos: i + 1 };
    }
    out += ch;
    i++;
  }
  const msg = contextLabel
    ? `Missing closing '${delim}' after ${contextLabel}`
    : `Unterminated delimiter '${delim}'`;
  throw new SedmatParseError(msg, Math.max(0, start - 1), {
    length: Math.max(1, src.length - Math.max(0, start - 1)),
    hint: hint ?? `Add a closing '${delim}' to finish this segment`,
  });
}

function readAddressPoint(
  src: string,
  pos: number,
): { point: SedmatAddressPoint; nextPos: number } | null {
  const ch = src[pos];
  if (!ch) return null;

  if (ch === "$") {
    return { point: { kind: "last" }, nextPos: pos + 1 };
  }

  if (ch >= "0" && ch <= "9") {
    let end = pos;
    while (end < src.length && src[end]! >= "0" && src[end]! <= "9") end++;
    const index = Number.parseInt(src.slice(pos, end), 10);
    if (!Number.isFinite(index) || index < 1) {
      throw new SedmatParseError(`Invalid 1-based paragraph number "${src.slice(pos, end)}"`, pos);
    }
    return { point: { kind: "line", index }, nextPos: end };
  }

  if (ch === "/") {
    const { value, nextPos } = readDelimited(src, pos + 1, "/");
    let p = nextPos;
    let ignoreCase = false;
    if (src[p] === "I" || src[p] === "i") {
      // Peek: only consume 'i' as regex flag if followed by comma, !, command, or whitespace
      const after = src[p + 1];
      if (!after || after === "," || after === "!" || /\s/.test(after) || /[sdayic]/.test(after)) {
        ignoreCase = true;
        p++;
      }
    }
    return { point: { kind: "regex", pattern: value, ignoreCase }, nextPos: p };
  }

  return null;
}

function detectPositionalPattern(
  pattern: string,
  address: SedmatAddress | undefined,
): PositionalPattern | undefined {
  if (address) return undefined;
  if (pattern === "^$") return "emptyDoc";
  if (pattern === "^") return "startOfDoc";
  if (pattern === "$") return "endOfDoc";
  return undefined;
}

function readRegexFlags(
  src: string,
  pos: number,
): { ignoreCase: boolean; multiline: boolean; nextPos: number } {
  let ignoreCase = false;
  let multiline = false;
  let p = pos;
  while (p < src.length) {
    const fl = src[p]!;
    if (fl === "i" || fl === "I") {
      ignoreCase = true;
      p++;
    } else if (fl === "m") {
      multiline = true;
      p++;
    } else {
      break;
    }
  }
  return { ignoreCase, multiline, nextPos: p };
}

function readAddressExpr(
  src: string,
  startPos: number,
): { address: SedmatAddress; nextPos: number } | null {
  let pos = startPos;
  const len = src.length;
  const firstAddr = readAddressPoint(src, pos);
  if (!firstAddr) return null;
  pos = firstAddr.nextPos;
  let endPoint: SedmatAddressPoint | undefined;
  while (pos < len && (src[pos] === " " || src[pos] === "\t")) pos++;
  if (src[pos] === ",") {
    if (firstAddr.point.kind === "last") {
      throw new SedmatParseError(
        "Invalid address: $ cannot be range start (use N,$ instead)",
        startPos,
      );
    }
    pos++;
    while (pos < len && (src[pos] === " " || src[pos] === "\t")) pos++;
    const secondAddr = readAddressPoint(src, pos);
    if (!secondAddr) {
      throw new SedmatParseError("Invalid address: range end must be a number, $, or /regex/", pos);
    }
    if (
      firstAddr.point.kind === "line" &&
      secondAddr.point.kind === "line" &&
      secondAddr.point.index < firstAddr.point.index
    ) {
      throw new SedmatParseError(
        `Invalid address: range end (${secondAddr.point.index}) < start (${firstAddr.point.index})`,
        startPos,
      );
    }
    endPoint = secondAddr.point;
    pos = secondAddr.nextPos;
  }
  while (pos < len && (src[pos] === " " || src[pos] === "\t")) pos++;
  let negate = false;
  if (src[pos] === "!") {
    negate = true;
    pos++;
  }
  return {
    address: { start: firstAddr.point, end: endPoint, negate: negate || undefined },
    nextPos: pos,
  };
}

function readBraceBlock(src: string, startPos: number): { body: string; nextPos: number } {
  let j = startPos + 1;
  let quote: '"' | "'" | null = null;
  let depth = 1;
  while (j < src.length) {
    const ch = src[j]!;
    if (quote) {
      if (ch === "\\" && j + 1 < src.length) j += 2;
      else if (ch === quote) {
        quote = null;
        j++;
      } else j++;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      j++;
    } else if (ch === "{") {
      depth++;
      j++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { body: src.slice(startPos + 1, j), nextPos: j + 1 };
      }
      j++;
    } else {
      j++;
    }
  }
  throw new SedmatParseError("Missing closing '}' for brace flags", startPos, {
    length: Math.max(1, src.length - startPos),
    hint: "Close flags with '}', e.g. {b c=red}",
  });
}

/**
 * Parse a `@...` container prefix (v3.7):
 * - Scoped: `@2:`, `@2,5:`, `@*:`, `@Summary:`, `@"Q4 Budget":`, `@slide=2:`, `@2:title:`, `@2:notes:`, `@header:`
 * - Unscoped container op (no trailing `:`): `@3d`, `@$a/.../`, `@2i/.../`, `@3{move=1}`, `@2{dup}`
 */
function readContainerPrefix(
  src: string,
  startPos: number,
): { scope: SedmatContainerScope; hasColon: boolean; nextPos: number } {
  let pos = startPos + 1; // skip '@'
  const len = src.length;
  if (pos >= len) {
    throw new SedmatParseError("Expected container target after '@'", startPos, {
      hint: "Examples: @2:s/old/new/, @*:s/old/new/g, @2:title:s/.*/New/, @header:s/.../",
    });
  }

  let containerType: ContainerType | undefined;

  // Check optional typed prefix: slide=, sheet=, tab=, page=, section=
  const typeMatch = /^(slide|sheet|tab|page|section)=/i.exec(src.slice(pos));
  if (typeMatch) {
    containerType = typeMatch[1]!.toLowerCase() as ContainerType;
    pos += typeMatch[0].length;
  }

  let target: ContainerTarget;
  let region: string | undefined;

  const ch = src[pos];
  if (!ch) {
    throw new SedmatParseError("Expected container target after '@'", pos);
  }

  if (ch === "*") {
    target = { kind: "all" };
    pos++;
  } else if (ch === '"' || ch === "'") {
    const q = ch;
    pos++;
    let name = "";
    while (pos < len && src[pos] !== q) {
      if (src[pos] === "\\" && pos + 1 < len) {
        name += src[pos + 1]!;
        pos += 2;
      } else {
        name += src[pos]!;
        pos++;
      }
    }
    if (src[pos] !== q) {
      throw new SedmatParseError("Unterminated quoted container name", startPos);
    }
    pos++;
    target = { kind: "name", name };
  } else if (ch === "$" || (ch >= "0" && ch <= "9")) {
    const addr = readAddressExpr(src, pos);
    if (!addr) {
      throw new SedmatParseError("Invalid container address after '@'", pos);
    }
    target = { kind: "address", address: addr.address };
    pos = addr.nextPos;
  } else if (/[A-Za-z_]/.test(ch)) {
    let end = pos;
    while (end < len && /[A-Za-z0-9_-]/.test(src[end]!)) end++;
    const ident = src.slice(pos, end);
    pos = end;
    if (!containerType && REGION_ONLY_NAMES.has(ident.toLowerCase()) && src[pos] === ":") {
      target = { kind: "regionOnly" };
      region = ident.toLowerCase();
    } else {
      target = { kind: "name", name: ident };
    }
  } else {
    throw new SedmatParseError(`Unexpected character '${ch}' in '@' container scope`, pos);
  }

  let hasColon = false;
  if (src[pos] === ":") {
    hasColon = true;
    pos++;
    // Optional sub-region before a second `:` (e.g. `@2:title:...`, `@2:notes:...`, `@2:shape=2:...`)
    if (!region) {
      const regMatch = /^([A-Za-z][A-Za-z0-9_-]*(?:=\d+)?):/.exec(src.slice(pos));
      if (regMatch) {
        const candidate = regMatch[1]!.toLowerCase();
        // Do not swallow single-letter commands like `s:` (if user used `:` as delimiter)
        if (candidate.length > 1) {
          region = candidate;
          pos += regMatch[0].length;
        }
      }
    }
  }

  return {
    scope: { containerType, target, region },
    hasColon,
    nextPos: pos,
  };
}

/**
 * Parse a standalone container scope string (e.g. `"@2"`, `"@2,5"`, `"@Summary"`, `"@slide=2:notes"`).
 * Useful for CLI flags (`--slide`, `--tab`, `--sheet`) and tool `scope` options.
 */
export function parseContainerScope(raw: string): SedmatContainerScope {
  const trimmed = raw.trim();
  const normalized = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  const withColon = normalized.endsWith(":") ? normalized : `${normalized}:`;
  const parsed = readContainerPrefix(withColon, 0);
  return parsed.scope;
}

/**
 * Parse one or more SEDMAT v3.7 commands separated by `;` or newlines.
 * Lines starting with `#` are treated as comments.
 */
export function parseSedmat(script: string): SedmatCommand[] {
  const commands: SedmatCommand[] = [];
  const len = script.length;
  let pos = 0;

  const skipWsAndSep = (): void => {
    while (pos < len) {
      const ch = script[pos]!;
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === ";") {
        pos++;
      } else if (ch === "#") {
        while (pos < len && script[pos] !== "\n") pos++;
      } else {
        break;
      }
    }
  };

  while (pos < len) {
    skipWsAndSep();
    if (pos >= len) break;

    // 0. Optional `@` generic container scope / container-level op (SEDMAT v3.7)
    let scope: SedmatContainerScope | undefined;
    if (script[pos] === "@") {
      const parsedScope = readContainerPrefix(script, pos);
      scope = parsedScope.scope;
      pos = parsedScope.nextPos;

      // Container-level direct op (no `:`): `@3d`, `@$a/.../`, `@2i/.../`, `@3{move=1}`, `@2{dup}`
      if (!parsedScope.hasColon) {
        const opChar = script[pos];
        if (!opChar || opChar === ";" || opChar === "\n" || opChar === "\r") {
          throw new SedmatParseError("Container scope without command", pos, {
            hint: "Add ':' for scoped edits (e.g. @2:s/old/new/) or a container op (d, a/…/, {dup}, {move=1})",
          });
        }
        if (opChar === "d") {
          pos++;
          commands.push({ type: "container", scope, op: "delete" });
          continue;
        }
        if (opChar === "a" || opChar === "i") {
          const op = opChar === "a" ? "append" : "insert";
          pos++;
          const delim = script[pos];
          if (!delim || /\s/.test(delim) || isAlphanumeric(delim)) {
            throw new SedmatParseError(`Expected delimiter after '@...${opChar}'`, pos);
          }
          pos++;
          const payload = readDelimited(script, pos, delim);
          pos = payload.nextPos;
          commands.push({
            type: "container",
            scope,
            op,
            text: payload.value,
            segments: parseReplacementSegments(payload.value),
          });
          continue;
        }
        if (opChar === "{") {
          const brace = readBraceBlock(script, pos);
          pos = brace.nextPos;
          commands.push({
            type: "container",
            scope,
            op: "style",
            flags: parseBraceFlags(brace.body),
          });
          continue;
        }
        throw new SedmatParseError(
          `Expected ':', 'd', 'a', 'i', or '{...}' after '@' container scope`,
          pos,
          { hint: "Use ':' before commands (e.g. @2:s/old/new/) or {dup} / {move=1} / d directly" },
        );
      }

      // After `@scope:`, allow direct container brace styling (`@1:{z=#0F172A}`, `@2:{notes="..."}`)
      // OR shorthand `@2:{T=1!A1}/value/` when `{...}` is immediately followed by a delimiter
      while (pos < len && (script[pos] === " " || script[pos] === "\t")) pos++;
      if (script[pos] === "{") {
        const brace = readBraceBlock(script, pos);
        const after = script[brace.nextPos];
        if (after && !/\s/.test(after) && after !== ";" && !isAlphanumeric(after)) {
          // Shorthand `@2:{T=1!A1}/replacement/[flags]` -> synthesize substitute command
          const patVal = `{${brace.body}}`;
          const delim = after;
          const rep = readDelimited(script, brace.nextPos + 1, delim);
          pos = rep.nextPos;
          const segments = parseReplacementSegments(rep.value);
          commands.push({
            type: "substitute",
            scope,
            pattern: patVal,
            replacement: rep.value,
            segments,
            global: false,
            ignoreCase: false,
            multiline: false,
            tableTarget: parseTablePattern(patVal) ?? undefined,
            imageTarget: parseImagePattern(patVal) ?? undefined,
          });
          continue;
        }
        pos = brace.nextPos;
        commands.push({
          type: "container",
          scope,
          op: "style",
          flags: parseBraceFlags(brace.body),
        });
        continue;
      }
    }

    // 1. Optional classic sed address: N | N,M | $ | N,$ | /re/ | /re1/,/re2/ + optional !
    let address: SedmatAddress | undefined;
    const addrParsed = readAddressExpr(script, pos);
    if (addrParsed) {
      address = addrParsed.address;
      pos = addrParsed.nextPos;
      while (pos < len && (script[pos] === " " || script[pos] === "\t")) pos++;
    }

    // 2. Command verb
    const cmd = script[pos];
    if (!cmd || cmd === ";" || cmd === "\n" || cmd === "\r") {
      throw new SedmatParseError("Address without command", pos, {
        hint: "Follow address with s/pat/rep/, d, a/text/, i/text/, or c/text/",
      });
    }
    pos++;

    switch (cmd) {
      case "s": {
        const delim = script[pos];
        if (!delim || /\s/.test(delim) || isAlphanumeric(delim)) {
          throw new SedmatParseError("Expected delimiter after 's'", pos, {
            hint: "Use '/', '|', or '#' — e.g. s/old/new/g",
          });
        }
        pos++;
        const patStart = pos;
        const pat = readDelimited(
          script,
          pos,
          delim,
          "search pattern",
          `Continue with ${delim}replacement${delim} — e.g. s${delim}old${delim}new${delim}g`,
        );
        const rep = readDelimited(
          script,
          pat.nextPos,
          delim,
          "replacement",
          `Add a closing '${delim}' (and optional flags g, i, m)`,
        );
        pos = rep.nextPos;

        let global = false;
        let ignoreCase = false;
        let multiline = false;
        let occurrence: number | undefined;
        while (pos < len) {
          const fl = script[pos]!;
          if (fl === "g") {
            global = true;
            pos++;
          } else if (fl === "i" || fl === "I") {
            ignoreCase = true;
            pos++;
          } else if (fl === "m") {
            multiline = true;
            pos++;
          } else if (fl >= "1" && fl <= "9") {
            let numEnd = pos;
            while (numEnd < len && script[numEnd]! >= "0" && script[numEnd]! <= "9") numEnd++;
            occurrence = Number.parseInt(script.slice(pos, numEnd), 10);
            pos = numEnd;
          } else {
            break;
          }
        }

        const segments = parseReplacementSegments(rep.value);
        const tableTarget = parseTablePattern(pat.value) ?? undefined;
        const imageTarget = tableTarget ? undefined : (parseImagePattern(pat.value) ?? undefined);
        const positional =
          !tableTarget && !imageTarget ? detectPositionalPattern(pat.value, address) : undefined;

        if (!tableTarget && !imageTarget && !positional && pat.value) {
          try {
            new RegExp(pat.value);
          } catch (reErr) {
            throw new SedmatParseError(
              `Invalid regex pattern: ${reErr instanceof Error ? reErr.message : String(reErr)}`,
              patStart,
              {
                length: Math.max(1, pat.value.length),
                hint: "Escape special regex characters like [, (, *, +, ? with '\\'",
              },
            );
          }
        }

        let tableCreate: Extract<TableSpec, { kind: "create" }> | undefined;
        for (const seg of segments) {
          if (seg.kind === "brace" && seg.flags?.table?.kind === "create") {
            tableCreate = seg.flags.table;
            break;
          }
        }

        commands.push({
          type: "substitute",
          scope,
          address,
          pattern: pat.value,
          replacement: rep.value,
          segments,
          global,
          ignoreCase,
          multiline,
          occurrence,
          positional,
          tableTarget,
          imageTarget,
          tableCreate,
        });
        break;
      }

      case "d": {
        // Supports `5d`, `3,7d`, `$d`, `/foo/d`, `3,7d/pattern/[im]`, AND `d/pattern/[im]`
        const next = script[pos];
        if (next && next !== ";" && next !== "\n" && next !== "\r" && !/\s/.test(next)) {
          if (isAlphanumeric(next)) {
            throw new SedmatParseError(`Expected delimiter after 'd', got '${next}'`, pos);
          }
          const delim = next;
          pos++;
          const pat = readDelimited(script, pos, delim);
          if (pat.value === "") {
            throw new SedmatParseError("Invalid delete command: empty pattern", pos);
          }
          const rflags = readRegexFlags(script, pat.nextPos);
          pos = rflags.nextPos;
          commands.push({
            type: "delete",
            scope,
            address,
            pattern: pat.value,
            ignoreCase: rflags.ignoreCase || undefined,
            multiline: rflags.multiline || undefined,
          });
        } else {
          if (!address) {
            throw new SedmatParseError("Invalid delete command (expected d/pattern/ or [addr]d)", pos);
          }
          commands.push({ type: "delete", scope, address });
        }
        break;
      }

      case "a":
      case "i":
      case "c": {
        const type = cmd === "a" ? "append" : cmd === "i" ? "insert" : "change";
        // Supports:
        //   5a/Appended text/
        //   @2:body:a/Appended text/  (region-scoped single-arg append/insert)
        //   a/pattern/Appended text/[im]  (two delimited segments when no address/region)
        //   5a\ Appended text (newline-terminated)
        const delim = script[pos];
        if (!delim) {
          throw new SedmatParseError(`Expected delimiter after '${cmd}'`, pos);
        }
        if (delim === "\\" || delim === " ") {
          pos++;
          if (script[pos] === "\n") pos++;
          const nl = script.indexOf("\n", pos);
          const text = nl === -1 ? script.slice(pos) : script.slice(pos, nl);
          pos = nl === -1 ? len : nl + 1;
          commands.push({
            type,
            scope,
            address,
            text,
            segments: parseReplacementSegments(text),
          });
        } else {
          if (isAlphanumeric(delim)) {
            throw new SedmatParseError(`Expected delimiter after '${cmd}', got '${delim}'`, pos);
          }
          pos++;
          const first = readDelimited(script, pos, delim);
          pos = first.nextPos;
          // Two-segment pattern form (`a/pattern/text/[im]`) when unaddressed
          if (
            !address &&
            pos < len &&
            script[pos] !== ";" &&
            script[pos] !== "\n" &&
            script[pos] !== "\r" &&
            !/\s/.test(script[pos]!)
          ) {
            const second = readDelimited(script, pos, delim);
            const rflags = readRegexFlags(script, second.nextPos);
            pos = rflags.nextPos;
            commands.push({
              type,
              scope,
              pattern: first.value,
              ignoreCase: rflags.ignoreCase || undefined,
              multiline: rflags.multiline || undefined,
              text: second.value,
              segments: parseReplacementSegments(second.value),
            });
          } else {
            // Allow single-arg append/insert when either an address OR a container scope (e.g. `@2:notes:a/Pause/`) is present
            if (!address && !scope && cmd !== "c") {
              throw new SedmatParseError(
                `Invalid ${cmd} command (expected ${cmd}/pattern/text/ or [addr]${cmd}/text/)`,
                pos,
              );
            }
            if (first.value === "" && (address || scope) && cmd !== "c") {
              throw new SedmatParseError(
                `Invalid addressed ${cmd} command (expected [addr]${cmd}/text/)`,
                pos,
              );
            }
            commands.push({
              type,
              scope,
              address,
              text: first.value,
              segments: parseReplacementSegments(first.value),
            });
          }
        }
        break;
      }

      case "y": {
        const delim = script[pos];
        if (!delim || /\s/.test(delim) || isAlphanumeric(delim)) {
          throw new SedmatParseError("Expected delimiter after 'y'", pos);
        }
        pos++;
        const srcChars = readDelimited(script, pos, delim);
        const dstChars = readDelimited(script, srcChars.nextPos, delim);
        pos = dstChars.nextPos;
        const srcRunes = [...srcChars.value];
        const dstRunes = [...dstChars.value];
        if (srcRunes.length === 0) {
          throw new SedmatParseError("Transliterate: empty source", pos);
        }
        if (srcRunes.length !== dstRunes.length) {
          throw new SedmatParseError(
            `'y' command source (${srcRunes.length}) and destination (${dstRunes.length}) lengths must match`,
            pos,
          );
        }
        commands.push({
          type: "transliterate",
          scope,
          address,
          source: srcChars.value,
          dest: dstChars.value,
        });
        break;
      }

      default: {
        // Capture full unexpected word token so editors can underline the whole bad verb/flag
        let badEnd = pos;
        while (badEnd < len && /[A-Za-z0-9_-]/.test(script[badEnd]!)) badEnd++;
        const badTok = script.slice(pos - 1, badEnd);
        throw new SedmatParseError(`Unknown SEDMAT command '${badTok}'`, pos - 1, {
          length: badTok.length,
          hint: "Expected s/pat/rep/, d/pat/, a/text/, i/text/, c/text/, y/src/dst/, or @scope:",
        });
      }
    }
  }

  return commands;
}

/** Parse a SEDMAT script into a `SedmatProgram` (matching `libsedmat-go` terminology). */
export function parseProgram(script: string): SedmatProgram {
  return { commands: parseSedmat(script) };
}

/** Parse a single SEDMAT expression (throws if empty or contains multiple commands). */
export function parseExpression(expr: string): SedmatCommand {
  const cmds = parseSedmat(expr);
  if (cmds.length === 0) {
    throw new SedmatParseError("Empty expression", 0);
  }
  if (cmds.length > 1) {
    throw new SedmatParseError(
      `Expected single expression, found ${cmds.length} commands (use parseProgram/parseSedmat)`,
      0,
    );
  }
  return cmds[0]!;
}
