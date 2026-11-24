/**
 * SEDMAT v3.6 Target-Agnostic Backend Interface & Generic Executor.
 *
 * This module defines the strict boundary between `libsedmat` (parser, addressing,
 * brace resolution, execution orchestration, dry-run planning) and any concrete
 * document engine (Word `libMW`, Google Docs, Markdown, Slides, in-memory, etc.).
 */

import { formatNumbered, formatStructure, resolveAddressElements } from "./address.js";
import { expandBackrefs, resolveReplacementSpans } from "./brace.js";
import { parseContainerScope, parseSedmat } from "./parser.js";
import {
  AddressElement,
  ImageSpec,
  PositionalPattern,
  SedmatCommand,
  SedmatContainerCmd,
  SedmatContainerScope,
  SedmatFormatFlags,
  SedmatStyledSpan,
  SedmatSubstituteCmd,
  TableSpec,
} from "./types.js";

/** One resolved regex match replacement inside a paragraph element. */
export interface MatchReplacement {
  start: number;
  end: number;
  matchedText: string;
  spans: SedmatStyledSpan[];
}

/**
 * Target-agnostic adapter interface implemented by document engines
 * (e.g. `WordSedmatBackend` in `@voxio/libmw`, `MemorySedmatBackend`, Google Docs, etc.).
 */
export interface SedmatBackend {
  /** Return all top-level addressable elements in document order (1-based `number`). */
  listElements(): AddressElement[];

  /**
   * Apply one or more regex match replacements within element at 0-based `elementIndex`.
   * Backends preserve existing run formatting outside replaced slices and apply span flags.
   */
  replaceInElement(elementIndex: number, replacements: MatchReplacement[]): void;

  /**
   * Delete elements at the given 0-based indices (provided sorted ascending).
   * Backends handle document-specific invariants (e.g. preserving mandatory trailing empty paragraph
   * or emitting native Track Changes `<w:del>`).
   */
  deleteElements(elementIndices: number[]): void;

  /**
   * Insert new element(s) constructed from resolved styled spans.
   * - `position: "before"` / `"after"` inserts relative to 0-based `anchorIndex`
   * - `position: "replace"` replaces the element at `anchorIndex` (`c` command)
   */
  insertElements(
    position: "before" | "after" | "replace",
    anchorIndex: number,
    paragraphs: SedmatStyledSpan[][],
  ): void;

  /**
   * Character-for-character transliteration within element at 0-based `elementIndex`.
   * Returns true if any character changed.
   */
  transliterateElement(elementIndex: number, charMap: ReadonlyMap<string, string>): boolean;

  /**
   * Optional: handle document-level positional insert (`s/^$/.../ `, `s/^/.../`, `s/$/.../`).
   * Returns number of applied insertions (0 for no-op `^$` on non-empty document).
   */
  applyPositionalInsert?(
    positional: PositionalPattern,
    paragraphs: SedmatStyledSpan[][],
    tableCreate?: Extract<TableSpec, { kind: "create" }>,
  ): number;

  /**
   * Optional: handle table operations (`{T=RxC}`, `{T=1!A1}`, `{T=1!row=+2}`, `{T=1!A1:C3}/merge/`, `{T=1}//`).
   * Returns number of affected tables/cells/rows/cols.
   */
  applyTableOp?(
    spec: TableSpec,
    replacement: string,
    spans: SedmatStyledSpan[],
  ): number;

  /**
   * Optional: handle image reference operations (`{img=1}`, `{img=-1}`, `{img=*}`, `{img=regex}`).
   * Returns number of affected images.
   */
  applyImageOp?(
    spec: ImageSpec,
    replacement: string,
    spans: SedmatStyledSpan[],
  ): number;

  /**
   * Optional: apply document/section-level container flags (e.g. `{cols=N}`, `{+=s}`)
   * triggered when a substitution matches inside an element.
   */
  applyContainerFlags?(elementIndex: number, flags: SedmatFormatFlags): void;

  /**
   * Optional (SEDMAT v3.7): resolve a `@` container scope (e.g. `@2:`, `@2,5:`,
   * `@2:title:`, `@2:notes:`, `@Summary:`, `@header:`) into one or more scoped
   * sub-backends. Every standard command then executes identically inside each scope.
   */
  forScope?(scope: SedmatContainerScope): SedmatBackend[];

  /**
   * Optional (SEDMAT v3.7): execute a container-level structural/styling command
   * (`@3d`, `@$a/{layout=two-col}Title/`, `@2i/.../`, `@3{move=1}`, `@2{dup}`, `@1:{z=#0F172A}`).
   * Returns number of affected containers.
   */
  applyContainerOp?(cmd: SedmatContainerCmd, spans: SedmatStyledSpan[]): number;
}

export interface DryRunAction {
  commandIndex: number;
  commandType: SedmatCommand["type"];
  description: string;
  elementNumbers: number[];
  matchCount: number;
}

export interface SedmatExecuteOptions {
  /** When true, evaluate addresses & matches and build `actions` WITHOUT mutating the backend. */
  dryRun?: boolean;
  /** Strict SEDMAT v3.6 address bounds validation (default: true). */
  strictAddresses?: boolean;
  /** Optional default `@` container scope (e.g. `"@2"`, `"@Summary"`, or parsed scope) applied to unscoped commands. */
  defaultScope?: string | SedmatContainerScope;
}

export interface SedmatExecuteResult {
  ok: true;
  dryRun: boolean;
  commandCount: number;
  matchCount: number;
  actions: DryRunAction[];
  summary: string;
}

/** Expand backrefs inside resolved spans and split on `\n` into paragraph span lists. */
export function expandSpansToParagraphs(
  spans: readonly SedmatStyledSpan[],
  match: RegExpExecArray | null,
): SedmatStyledSpan[][] {
  const paragraphs: SedmatStyledSpan[][] = [[]];
  for (const span of spans) {
    const expanded = span.implicitMatchText
      ? (match?.[0] ?? "")
      : match
        ? expandBackrefs(span.text, match)
        : span.text;

    const lines = expanded.split("\n");
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) paragraphs.push([]);
      const lineText = lines[li]!;
      const hasNonTextPayload =
        span.flags &&
        (span.flags.break !== undefined ||
          span.flags.toc !== undefined ||
          span.flags.table !== undefined ||
          span.flags.image !== undefined ||
          span.flags.comment !== undefined ||
          span.flags.bookmark !== undefined ||
          span.flags.checkbox !== undefined ||
          span.flags.heading !== undefined ||
          span.flags.cols !== undefined);
      if (lineText.length > 0 || (li === 0 && hasNonTextPayload)) {
        paragraphs[paragraphs.length - 1]!.push({
          text: lineText,
          flags: span.flags ? { ...span.flags } : undefined,
        });
      }
    }
  }
  return paragraphs;
}

function expandInlineSpans(
  spans: readonly SedmatStyledSpan[],
  match: RegExpExecArray,
): SedmatStyledSpan[] {
  return spans.map((span) => ({
    text: span.implicitMatchText ? (match[0] ?? "") : expandBackrefs(span.text, match),
    flags: span.flags ? { ...span.flags } : undefined,
  }));
}

function buildRegex(pattern: string, opts: { global?: boolean; ignoreCase?: boolean; multiline?: boolean }): RegExp {
  let flags = "";
  if (opts.global) flags += "g";
  if (opts.ignoreCase) flags += "i";
  if (opts.multiline) flags += "m";
  return new RegExp(pattern, flags);
}

/**
 * Execute a SEDMAT v3.6 script (or pre-parsed command list) against any `SedmatBackend`.
 */
export function executeSedmat(
  backend: SedmatBackend,
  scriptOrCommands: string | readonly SedmatCommand[],
  options: SedmatExecuteOptions = {},
): SedmatExecuteResult {
  const commands =
    typeof scriptOrCommands === "string" ? parseSedmat(scriptOrCommands) : scriptOrCommands;
  const dryRun = options.dryRun === true;
  const strict = options.strictAddresses !== false;
  const defaultScope: SedmatContainerScope | undefined =
    typeof options.defaultScope === "string" && options.defaultScope.trim()
      ? parseContainerScope(options.defaultScope)
      : typeof options.defaultScope === "object"
        ? options.defaultScope
        : undefined;

  const actions: DryRunAction[] = [];
  let totalMatches = 0;

  for (let cmdIdx = 0; cmdIdx < commands.length; cmdIdx++) {
    const cmd = commands[cmdIdx]!;

    // Container-level structural/style operation (`@3d`, `@$a/.../`, `@3{move=1}`, `@1:{z=#0F172A}`)
    if (cmd.type === "container") {
      const spans = cmd.segments ? resolveReplacementSpans(cmd.segments) : [];
      if (dryRun) {
        actions.push({
          commandIndex: cmdIdx,
          commandType: "container",
          description: `container ${cmd.op}`,
          elementNumbers: [],
          matchCount: 1,
        });
        totalMatches++;
      } else if (backend.applyContainerOp) {
        const count = backend.applyContainerOp(cmd, spans);
        totalMatches += count;
        actions.push({
          commandIndex: cmdIdx,
          commandType: "container",
          description: `container ${cmd.op}`,
          elementNumbers: [],
          matchCount: count,
        });
      }
      continue;
    }

    const effectiveScope = cmd.scope ?? defaultScope;
    const targets: SedmatBackend[] =
      effectiveScope && backend.forScope ? backend.forScope(effectiveScope) : [backend];

    for (const targetBackend of targets) {
      const elements = targetBackend.listElements();

      switch (cmd.type) {
        case "substitute": {
          const sub: SedmatSubstituteCmd = cmd;
          const resolvedSpans = resolveReplacementSpans(sub.segments);

          // 1. Table target (`s/{T=1!A1}/value/`, `s/{T=1}//`, `s/{T=1!row=$+}//`, `s/{T=1!A1:C3}/merge/`)
          if (sub.tableTarget) {
            if (dryRun) {
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `table op (${sub.tableTarget.kind}) -> "${sub.replacement}"`,
                elementNumbers: [],
                matchCount: 1,
              });
              totalMatches++;
            } else if (targetBackend.applyTableOp) {
              const count = targetBackend.applyTableOp(sub.tableTarget, sub.replacement, resolvedSpans);
              totalMatches += count;
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `table op (${sub.tableTarget.kind})`,
                elementNumbers: [],
                matchCount: count,
              });
            }
            break;
          }

          // 2. Image target (`s/{img=1}/.../`, `s/{img=-1}//`)
          if (sub.imageTarget) {
            if (dryRun) {
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `image op (${sub.imageTarget.kind}) -> "${sub.replacement}"`,
                elementNumbers: [],
                matchCount: 1,
              });
              totalMatches++;
            } else if (targetBackend.applyImageOp) {
              const count = targetBackend.applyImageOp(sub.imageTarget, sub.replacement, resolvedSpans);
              totalMatches += count;
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `image op (${sub.imageTarget.kind})`,
                elementNumbers: [],
                matchCount: count,
              });
            }
            break;
          }

          // 3. Document-level positional insert (`s/^$/.../`, `s/^/.../`, `s/$/.../`)
          if (sub.positional && targetBackend.applyPositionalInsert) {
            const isEmpty = elements.every((el) => el.kind === "paragraph" && el.text.trim() === "");
            const paragraphs = expandSpansToParagraphs(resolvedSpans, null);
            if (sub.positional === "emptyDoc" && !isEmpty) {
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `positional ^$ skipped (document not empty)`,
                elementNumbers: [],
                matchCount: 0,
              });
              break;
            }
            if (dryRun) {
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `positional insert (${sub.positional}): ${paragraphs.length} paragraph(s)`,
                elementNumbers: [],
                matchCount: 1,
              });
              totalMatches++;
            } else {
              const count = targetBackend.applyPositionalInsert(sub.positional, paragraphs, sub.tableCreate);
              totalMatches += count;
              actions.push({
                commandIndex: cmdIdx,
                commandType: "substitute",
                description: `positional insert (${sub.positional})`,
                elementNumbers: [],
                matchCount: count,
              });
            }
            break;
          }

          // 4. Standard regex substitution (optionally scoped by 1-based address)
          const targetIndices = resolveAddressElements(sub.address, elements, { strict });
          const matchedElements: number[] = [];
          let cmdMatches = 0;

          for (const elIdx of targetIndices) {
            const el = elements[elIdx];
            if (!el || el.kind !== "paragraph") continue;

            const re = buildRegex(sub.pattern, {
              global: sub.global || Boolean(sub.occurrence),
              ignoreCase: sub.ignoreCase,
              multiline: sub.multiline,
            });

            const replacements: MatchReplacement[] = [];
            let m: RegExpExecArray | null;
            let count = 0;
            while ((m = re.exec(el.text)) !== null) {
              count++;
              if (!sub.occurrence || count === sub.occurrence) {
                replacements.push({
                  start: m.index,
                  end: m.index + m[0].length,
                  matchedText: m[0],
                  spans: expandInlineSpans(resolvedSpans, m),
                });
              }
              if (!sub.global && !sub.occurrence) break;
              if (m[0].length === 0) {
                if (re.lastIndex >= el.text.length) break;
                re.lastIndex++;
              }
            }

            if (replacements.length === 0) continue;
            cmdMatches += replacements.length;
            matchedElements.push(el.number);

            if (!dryRun) {
              targetBackend.replaceInElement(elIdx, replacements);
              if (targetBackend.applyContainerFlags) {
                for (const rep of replacements) {
                  for (const sp of rep.spans) {
                    if (sp.flags && (sp.flags.cols !== undefined || sp.flags.break === "section")) {
                      targetBackend.applyContainerFlags(elIdx, sp.flags);
                    }
                  }
                }
              }
            }
          }

          totalMatches += cmdMatches;
          actions.push({
            commandIndex: cmdIdx,
            commandType: "substitute",
            description: `s/${sub.pattern}/${sub.replacement}/${sub.global ? "g" : ""}${sub.ignoreCase ? "i" : ""}${sub.multiline ? "m" : ""}`,
            elementNumbers: matchedElements,
            matchCount: cmdMatches,
          });
          break;
        }

        case "delete": {
          const targetIndices = resolveAddressElements(cmd.address, elements, { strict });
          const inlineRe = cmd.pattern
            ? buildRegex(cmd.pattern, { ignoreCase: cmd.ignoreCase, multiline: cmd.multiline })
            : null;

          const deleteIndices = targetIndices.filter((idx) => {
            const el = elements[idx];
            if (!el) return false;
            if (inlineRe && !inlineRe.test(el.text)) return false;
            return true;
          });

          totalMatches += deleteIndices.length;
          actions.push({
            commandIndex: cmdIdx,
            commandType: "delete",
            description: `delete ${deleteIndices.length} element(s)`,
            elementNumbers: deleteIndices.map((i) => elements[i]!.number),
            matchCount: deleteIndices.length,
          });

          if (!dryRun && deleteIndices.length > 0) {
            targetBackend.deleteElements(deleteIndices);
          }
          break;
        }

        case "append":
        case "insert":
        case "change": {
          const resolvedSpans = resolveReplacementSpans(cmd.segments);
          const paragraphs = expandSpansToParagraphs(resolvedSpans, null);

          // Scoped single-arg append/insert without explicit line address or pattern (e.g. `@2:notes:a/Pause/`)
          if (effectiveScope && !cmd.address && !cmd.pattern) {
            const anchor =
              cmd.type === "append"
                ? Math.max(0, elements.length - 1)
                : 0;
            totalMatches += 1;
            actions.push({
              commandIndex: cmdIdx,
              commandType: cmd.type,
              description: `${cmd.type} in scoped region`,
              elementNumbers: elements.length > 0 ? [anchor + 1] : [],
              matchCount: 1,
            });
            if (!dryRun) {
              const pos =
                cmd.type === "append" ? "after" : cmd.type === "insert" ? "before" : "replace";
              targetBackend.insertElements(pos, elements.length === 0 ? -1 : anchor, paragraphs);
            }
            break;
          }

          const targetIndices = resolveAddressElements(cmd.address, elements, { strict });
          const inlineRe = cmd.pattern
            ? buildRegex(cmd.pattern, { ignoreCase: cmd.ignoreCase, multiline: cmd.multiline })
            : null;

          const matchedIndices = targetIndices.filter((idx) => {
            const el = elements[idx];
            if (!el) return false;
            if (inlineRe && !inlineRe.test(el.text)) return false;
            return true;
          });

          totalMatches += matchedIndices.length;
          actions.push({
            commandIndex: cmdIdx,
            commandType: cmd.type,
            description: `${cmd.type} at ${matchedIndices.length} position(s)`,
            elementNumbers: matchedIndices.map((i) => elements[i]!.number),
            matchCount: matchedIndices.length,
          });

          if (!dryRun && matchedIndices.length > 0) {
            const position =
              cmd.type === "append" ? "after" : cmd.type === "insert" ? "before" : "replace";
            for (const idx of [...matchedIndices].sort((a, b) => b - a)) {
              targetBackend.insertElements(position, idx, paragraphs);
            }
          }
          break;
        }

        case "transliterate": {
          const targetIndices = resolveAddressElements(cmd.address, elements, { strict });
          const srcRunes = [...cmd.source];
          const dstRunes = [...cmd.dest];
          const charMap = new Map<string, string>();
          for (let i = 0; i < srcRunes.length; i++) {
            charMap.set(srcRunes[i]!, dstRunes[i]!);
          }

          const matchedElements: number[] = [];
          for (const idx of targetIndices) {
            const el = elements[idx];
            if (!el || el.kind !== "paragraph") continue;
            if (dryRun) {
              if ([...el.text].some((ch) => charMap.has(ch))) {
                matchedElements.push(el.number);
              }
            } else if (targetBackend.transliterateElement(idx, charMap)) {
              matchedElements.push(el.number);
            }
          }

          totalMatches += matchedElements.length;
          actions.push({
            commandIndex: cmdIdx,
            commandType: "transliterate",
            description: `y/${cmd.source}/${cmd.dest}/`,
            elementNumbers: matchedElements,
            matchCount: matchedElements.length,
          });
          break;
        }
      }
    }
  }

  return {
    ok: true,
    dryRun,
    commandCount: commands.length,
    matchCount: totalMatches,
    actions,
    summary: `${dryRun ? "[dry-run] " : ""}Applied ${commands.length} SEDMAT command(s) (${totalMatches} match${totalMatches === 1 ? "" : "es"})`,
  };
}

/** Introspect any `SedmatBackend` in `structure` format. */
export function inspectStructure(backend: SedmatBackend, maxPreviewLen?: number): string {
  return formatStructure(backend.listElements(), { maxPreviewLen });
}

/** Introspect any `SedmatBackend` in `cat -N` numbered format. */
export function inspectNumbered(backend: SedmatBackend, includeMeta = false): string {
  return formatNumbered(backend.listElements(), { includeMeta });
}
