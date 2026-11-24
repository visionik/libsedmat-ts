import type {
  Address,
  AddressElement,
  AddressMutation,
  DocumentParagraph,
  DocumentSegment,
  Expression,
  FormatIntent,
  ImageSpec,
  TableCreateMutation,
  TableCreateSpec,
  TextPlan,
} from "./types.ts";
import { parseMarkdownReplacement } from "./markdown.ts";
import { parseImageSyntax } from "./references.ts";

export interface MatchAction {
  startIndex: number;
  endIndex: number;
  oldText: string;
  text: string;
  formats: string[];
  image?: ImageSpec;
  brace?: Expression["brace"];
  braceSpans?: Expression["braceSpans"];
}

export function compileSedRegex(pattern: string, global = true): RegExp {
  let flags = global ? "g" : "";
  let body = pattern;
  let changed = true;
  while (changed) {
    changed = false;
    if (body.startsWith("(?i)")) {
      if (!flags.includes("i")) flags += "i";
      body = body.slice(4);
      changed = true;
    } else if (body.startsWith("(?m)")) {
      if (!flags.includes("m")) flags += "m";
      body = body.slice(4);
      changed = true;
    } else if (body.startsWith("(?im)") || body.startsWith("(?mi)")) {
      if (!flags.includes("i")) flags += "i";
      if (!flags.includes("m")) flags += "m";
      body = body.slice(5);
      changed = true;
    }
  }
  return new RegExp(body, flags);
}

export function expandReplacement(template: string, match: RegExpExecArray): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (ch === "\\" && i + 1 < template.length) {
      const next = template[i + 1]!;
      if (next === "&") {
        out += "&";
        i++;
        continue;
      }
      if (next === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (next >= "1" && next <= "9") {
        out += match[Number.parseInt(next, 10)] ?? "";
        i++;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === "&") {
      out += match[0] ?? "";
      continue;
    }
    if (ch === "$" && i + 1 < template.length) {
      const next = template[i + 1]!;
      if (next === "$") {
        out += "$";
        i++;
        continue;
      }
      if (next === "0") {
        out += match[0] ?? "";
        i++;
        continue;
      }
      if (next >= "1" && next <= "9") {
        out += match[Number.parseInt(next, 10)] ?? "";
        i++;
        continue;
      }
      if (next === "{") {
        const close = template.indexOf("}", i + 2);
        if (close > i + 2) {
          const idxStr = template.slice(i + 2, close);
          if (/^\d+$/.test(idxStr)) {
            out += match[Number.parseInt(idxStr, 10)] ?? "";
            i = close;
            continue;
          }
        }
      }
    }
    out += ch;
  }
  return out;
}

export function resolveAddress(address: Address, elements: AddressElement[]): AddressElement[] {
  if (elements.length === 0) {
    throw new Error("document has no paragraphs");
  }
  const last = elements.length;
  const start = address.start === -1 ? last : address.start;
  if (start < 1 || start > last) {
    throw new Error(`address ${start} out of range (document has ${last} paragraphs)`);
  }
  if (!address.hasRange) {
    return [elements[start - 1]!];
  }
  const end = address.end === 0 ? start : address.end === -1 ? last : address.end;
  if (end < 1 || end > last) {
    throw new Error(`address end ${end} out of range (document has ${last} paragraphs)`);
  }
  if (end < start) {
    throw new Error(`address range ${start},${end} is reversed`);
  }
  return elements.slice(start - 1, end);
}

function isContiguousTerminalRange(elements: AddressElement[], targets: AddressElement[]): boolean {
  if (targets.length < 2 || targets[targets.length - 1]!.number !== elements.length) {
    return false;
  }
  for (let i = 1; i < targets.length; i++) {
    if (targets[i]!.number !== targets[i - 1]!.number + 1) return false;
  }
  return true;
}

export function planAddressedDelete(elements: AddressElement[], targets: AddressElement[]): AddressMutation[] {
  if (targets.length === 0) return [];
  if (isContiguousTerminalRange(elements, targets)) {
    return [{
      startIndex: targets[0]!.startIndex,
      endIndex: targets[targets.length - 1]!.endIndex - 1,
    }];
  }
  const mutations: AddressMutation[] = [];
  for (const target of targets) {
    let startIndex = target.startIndex;
    let endIndex = target.endIndex;
    const isLast = target.number === elements.length;
    if (isLast && target.number > 1) {
      startIndex = elements[target.number - 2]!.endIndex - 1;
      endIndex = target.endIndex - 1;
    } else if (isLast && target.number === 1) {
      if (target.startIndex >= target.endIndex - 1) continue;
      endIndex = target.endIndex - 1;
    }
    mutations.push({ startIndex, endIndex });
  }
  return mutations;
}

export function planAddressedInsert(targets: AddressElement[], replacement: string): AddressMutation[] {
  let insertText = replacement.replace(/\\n/g, "\n");
  if (!insertText.endsWith("\n")) insertText += "\n";
  return targets.map((t) => ({
    startIndex: t.startIndex,
    endIndex: t.startIndex,
    insertText,
  }));
}

export function planAddressedAppend(targets: AddressElement[], replacement: string): AddressMutation[] {
  let insertText = replacement.replace(/\\n/g, "\n");
  insertText = insertText.endsWith("\n") ? `\n${insertText.slice(0, -1)}` : `\n${insertText}`;
  return targets.map((t) => ({
    startIndex: t.endIndex - 1,
    endIndex: t.endIndex - 1,
    insertText,
  }));
}

export class MatchPlanner {
  private readonly regex: RegExp;
  private readonly expression: Expression;

  constructor(expression: Expression) {
    this.expression = expression;
    this.regex = compileSedRegex(expression.pattern, true);
  }

  planParagraphs(paragraphs: DocumentParagraph[]): MatchAction[] {
    const actions: MatchAction[] = [];
    for (const para of paragraphs) {
      if (!para.text) continue;
      const matches: RegExpExecArray[] = [];
      this.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = this.regex.exec(para.text)) !== null) {
        matches.push(m);
        if (m[0].length === 0) {
          this.regex.lastIndex++;
          if (this.regex.lastIndex > para.text.length) break;
        }
        if (!this.expression.global && this.expression.nthMatch === 0) break;
        if (this.expression.nthMatch > 0 && matches.length >= this.expression.nthMatch) break;
      }

      const selected =
        this.expression.nthMatch > 0
          ? matches.length >= this.expression.nthMatch
            ? [matches[this.expression.nthMatch - 1]!]
            : []
          : matches;

      for (const match of selected) {
        const oldText = match[0]!;
        let expanded = expandReplacement(this.expression.replacement, match);
        // Implicit t=$0 for pure formatting brace expressions
        if (
          expanded === "" &&
          this.expression.replacement === "" &&
          this.expression.brace &&
          !this.expression.brace.hasBreak &&
          !this.expression.brace.hasToc &&
          !this.expression.brace.imgRef &&
          !this.expression.brace.tableRef
        ) {
          expanded = oldText;
        }
        // JS string indices are UTF-16 code units — exact match with SEDMAT UTF-16 coordinates!
        const startIndex = para.startIndex + match.index;
        const endIndex = startIndex + oldText.length;

        const img =
          parseImageSyntax(expanded) ??
          (this.expression.brace?.imgRef
            ? {
                url: this.expression.brace.imgRef,
                width: this.expression.brace.width,
                height: this.expression.brace.height,
              }
            : undefined);

        if (img) {
          actions.push({ startIndex, endIndex, oldText, text: "", formats: [], image: img });
        } else if (this.expression.brace) {
          actions.push({
            startIndex,
            endIndex,
            oldText,
            text: expanded,
            formats: [],
            brace: this.expression.brace,
            braceSpans: this.expression.braceSpans,
          });
        } else {
          const md = parseMarkdownReplacement(expanded);
          actions.push({
            startIndex,
            endIndex,
            oldText,
            text: md.text,
            formats: md.formats,
          });
        }
      }
    }
    return actions;
  }
}

export function planTextMutations(actions: MatchAction[]): TextPlan {
  const plan: TextPlan = {
    matchCount: actions.length,
    images: [],
    footnotes: [],
    textEdits: [],
    formatting: [],
  };

  let textDelta = 0;
  for (const action of actions) {
    if (action.formats.includes("footnote")) {
      const start = action.startIndex + textDelta;
      plan.footnotes.push({
        startIndex: start,
        endIndex: start + (action.endIndex - action.startIndex),
        text: action.text,
      });
      continue;
    }
    if (action.image) {
      plan.images.push({
        startIndex: action.startIndex,
        endIndex: action.endIndex,
        image: action.image,
      });
      continue;
    }
    const horizontalRule = action.formats.includes("hrule");
    const insertText = horizontalRule ? "\n" : action.text;
    plan.textEdits.push({
      startIndex: action.startIndex,
      endIndex: action.endIndex,
      insertText,
      horizontalRule: horizontalRule || undefined,
    });
    if (!horizontalRule && insertText !== "" && (action.formats.length > 0 || action.brace)) {
      const formatStart = action.startIndex + textDelta;
      const formatEnd = formatStart + insertText.length;
      const intent: FormatIntent = {
        startIndex: formatStart,
        endIndex: formatEnd,
        structuralStartIndex: formatStart,
        structuralEndIndex: formatEnd,
        formats: [...action.formats],
        leadingTab: insertText.startsWith("\t") || undefined,
        brace: action.brace,
        braceSpans: action.braceSpans,
      };
      plan.formatting.push(intent);
    }
    textDelta += insertText.length - (action.endIndex - action.startIndex);
  }
  return plan;
}

export function planTableCreate(segment: DocumentSegment, expr: Expression, spec: TableCreateSpec): TableCreateMutation | undefined {
  if (spec.rows < 1 || spec.columns < 1) {
    throw new Error(`invalid table shape: ${spec.rows}x${spec.columns}`);
  }
  const planner = new MatchPlanner({ ...expr, global: false, nthMatch: 0 });
  const actions = planner.planParagraphs(segment.paragraphs);
  if (actions.length === 0) return undefined;
  return {
    startIndex: actions[0]!.startIndex,
    endIndex: actions[0]!.endIndex,
    rows: spec.rows,
    columns: spec.columns,
  };
}
