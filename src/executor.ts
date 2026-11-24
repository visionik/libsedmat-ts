import type {
  AddressElement,
  Backend,
  DocumentParagraph,
  DocumentProjection,
  DocumentSegment,
  ExecuteOptions,
  ExecutionReport,
  Expression,
  ExpressionReport,
  Program,
  TextPlan,
} from "./types.ts";
import { enrich, parseProgram } from "./parser.ts";
import {
  compileSedRegex,
  MatchPlanner,
  planAddressedAppend,
  planAddressedDelete,
  planAddressedInsert,
  planTableCreate,
  planTextMutations,
  resolveAddress,
} from "./planner.ts";
import { addressElements, selectSegment } from "./introspect.ts";
import { parsePipeTable, parseTableCreate } from "./references.ts";

export class Executor {
  private readonly backend: Backend;

  constructor(backend: Backend) {
    this.backend = backend;
  }

  async executeString(script: string, opts: ExecuteOptions = {}): Promise<ExecutionReport> {
    const program = parseProgram(script);
    return this.execute(program, opts);
  }

  async execute(program: Program, opts: ExecuteOptions = {}): Promise<ExecutionReport> {
    const enriched = enrich(program);
    const dryRun = Boolean(opts.dryRun);
    const defaultTabId = opts.tabId ?? "";

    const report: ExecutionReport = {
      dryRun,
      tabId: defaultTabId,
      totalMatches: 0,
      expressions: [],
    };

    for (let idx = 0; idx < enriched.expressions.length; idx++) {
      const expr = enriched.expressions[idx]!;

      // Container-level operation (v3.7 `@3d`, `@$a/.../`, `@3{move=1}`, `@2{dup}`, `@4{hide}`)
      if (expr.container?.containerOp) {
        let count = 0;
        if (!dryRun && this.backend.applyContainerOp) {
          count = await this.backend.applyContainerOp(expr.container, expr);
        } else if (dryRun) {
          count = 1;
        }
        report.totalMatches += count;
        report.expressions.push({
          index: idx,
          command: expr.command,
          matchCount: count,
          dryRun,
        });
        continue;
      }

      const proj = await this.backend.project();
      const targetTabIds = resolveTargetTabs(proj, expr, defaultTabId);

      let exprMatches = 0;
      let lastReport: ExpressionReport = {
        index: idx,
        command: expr.command,
        matchCount: 0,
        dryRun,
      };

      for (const tabId of targetTabIds) {
        const freshProj = await this.backend.project();
        const seg = selectSegment(freshProj, tabId);
        const r = await this.executeOne(idx, expr, seg, tabId, dryRun);
        exprMatches += r.matchCount;
        lastReport = { ...r, matchCount: exprMatches };
      }

      report.totalMatches += exprMatches;
      report.expressions.push(lastReport);
    }

    return report;
  }

  private async executeOne(
    idx: number,
    expr: Expression,
    seg: DocumentSegment,
    tabId: string,
    dryRun: boolean,
  ): Promise<ExpressionReport> {
    const rep: ExpressionReport = {
      index: idx,
      command: expr.command,
      matchCount: 0,
      dryRun,
    };

    switch (expr.command) {
      case "brace": {
        // Container-scoped standalone brace expression (e.g. `@1:{z=#0F172A}`, `@2:{notes="..."}`)
        if (expr.container && this.backend.applyContainerOp) {
          rep.matchCount = dryRun ? 1 : await this.backend.applyContainerOp(expr.container, expr);
        }
        return rep;
      }
      case "s":
        return this.executeSubstitute(expr, seg, tabId, dryRun, rep);
      case "d":
        return this.executeDelete(expr, seg, tabId, dryRun, rep);
      case "a":
        return this.executeInsertAppend(expr, seg, tabId, dryRun, rep, false);
      case "i":
        return this.executeInsertAppend(expr, seg, tabId, dryRun, rep, true);
      case "y":
        return this.executeTransliterate(expr, seg, tabId, dryRun, rep);
      default:
        throw new Error(`unsupported command: ${expr.command}`);
    }
  }

  private async executeSubstitute(
    expr: Expression,
    seg: DocumentSegment,
    tabId: string,
    dryRun: boolean,
    rep: ExpressionReport,
  ): Promise<ExpressionReport> {
    const tableSpec = expr.tableCreate ?? parseTableCreate(expr.replacement) ?? parsePipeTable(expr.replacement);
    if (tableSpec) {
      const mutation = planTableCreate(seg, expr, tableSpec);
      if (!mutation) return rep;
      rep.matchCount = 1;
      rep.tableCreate = mutation;
      if (!dryRun) {
        await this.backend.applyTableCreate(tabId, mutation, tableSpec);
      }
      return rep;
    }

    if (expr.cell) {
      return this.executeCellSubstitute(expr, seg, tabId, dryRun, rep);
    }

    const planner = new MatchPlanner(expr);
    let paragraphs: DocumentParagraph[] = seg.paragraphs;
    if (expr.address) {
      const targets = resolveAddress(expr.address, addressElements(seg));
      paragraphs = targets
        .filter((t) => t.kind === "paragraph")
        .map((t) => ({ text: `${t.text}\n`, startIndex: t.startIndex, endIndex: t.endIndex }));
    }

    const actions = planner.planParagraphs(paragraphs);
    const plan = planTextMutations(actions);
    rep.matchCount = plan.matchCount;
    rep.textPlan = plan;
    if (!dryRun && plan.matchCount > 0) {
      await this.backend.applyTextPlan(tabId, plan);
    }
    return rep;
  }

  private async executeCellSubstitute(
    expr: Expression,
    seg: DocumentSegment,
    tabId: string,
    dryRun: boolean,
    rep: ExpressionReport,
  ): Promise<ExpressionReport> {
    const cellRef = expr.cell!;
    let tableIdx = cellRef.tableIndex;
    if (tableIdx < 0) tableIdx = seg.tables.length + tableIdx + 1;
    if (tableIdx < 1 || tableIdx > seg.tables.length) {
      throw new Error(`table ${cellRef.tableIndex} out of range (document has ${seg.tables.length} tables)`);
    }
    const table = seg.tables[tableIdx - 1]!;
    const combined: TextPlan = { matchCount: 0, images: [], footnotes: [], textEdits: [], formatting: [] };

    for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
      if (cellRef.row > 0 && rIdx + 1 !== cellRef.row) continue;
      const row = table.rows[rIdx]!;
      for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
        if (cellRef.column > 0 && cIdx + 1 !== cellRef.column) continue;
        const cell = row.cells[cIdx]!;
        if (expr.pattern) {
          const planner = new MatchPlanner(expr);
          const actions = planner.planParagraphs([
            { text: cell.text, startIndex: cell.textStartIndex, endIndex: cell.textEndIndex },
          ]);
          const plan = planTextMutations(actions);
          combined.matchCount += plan.matchCount;
          combined.textEdits.push(...plan.textEdits);
          combined.formatting.push(...plan.formatting);
        } else {
          const cellText = cell.text.replace(/\n+$/, "");
          const expanded = expr.replacement.replace(/\$\$/g, "$").replace(/\$\{0\}/g, cellText);
          const deleteEnd = cell.text.endsWith("\n") && cell.textEndIndex > cell.textStartIndex
            ? cell.textEndIndex - 1
            : cell.textEndIndex;
          combined.matchCount += 1;
          combined.textEdits.push({
            startIndex: cell.textStartIndex,
            endIndex: deleteEnd,
            insertText: expanded,
          });
        }
      }
    }

    rep.matchCount = combined.matchCount;
    rep.textPlan = combined;
    if (!dryRun && combined.matchCount > 0) {
      await this.backend.applyTextPlan(tabId, combined);
    }
    return rep;
  }

  private async executeDelete(
    expr: Expression,
    seg: DocumentSegment,
    tabId: string,
    dryRun: boolean,
    rep: ExpressionReport,
  ): Promise<ExpressionReport> {
    const elements = addressElements(seg);
    let targets: AddressElement[];
    if (expr.address) {
      targets = resolveAddress(expr.address, elements);
      if (expr.pattern) {
        const re = compileSedRegex(expr.pattern, false);
        targets = targets.filter((t) => re.test(t.text));
      }
    } else {
      const re = compileSedRegex(expr.pattern, false);
      targets = elements.filter((el) => el.kind === "paragraph" && re.test(el.text));
    }

    const mutations = planAddressedDelete(elements, targets);
    rep.matchCount = targets.length;
    rep.addressMutations = mutations;
    if (!dryRun && mutations.length > 0) {
      await this.backend.applyAddressMutations(tabId, mutations);
    }
    return rep;
  }

  private async executeInsertAppend(
    expr: Expression,
    seg: DocumentSegment,
    tabId: string,
    dryRun: boolean,
    rep: ExpressionReport,
    before: boolean,
  ): Promise<ExpressionReport> {
    const elements = addressElements(seg);
    let targets: AddressElement[];
    if (expr.address) {
      targets = resolveAddress(expr.address, elements);
    } else {
      const re = compileSedRegex(expr.pattern, false);
      targets = elements.filter((el) => el.kind === "paragraph" && re.test(el.text));
    }

    const mutations = before
      ? planAddressedInsert(targets, expr.replacement)
      : planAddressedAppend(targets, expr.replacement);
    rep.matchCount = targets.length;
    rep.addressMutations = mutations;
    if (!dryRun && mutations.length > 0) {
      await this.backend.applyAddressMutations(tabId, mutations);
    }
    return rep;
  }

  private async executeTransliterate(
    expr: Expression,
    seg: DocumentSegment,
    tabId: string,
    dryRun: boolean,
    rep: ExpressionReport,
  ): Promise<ExpressionReport> {
    const targets = expr.address ? resolveAddress(expr.address, addressElements(seg)) : [];
    if (dryRun) {
      const srcSet = new Set([...expr.pattern]);
      let count = 0;
      const texts = targets.length > 0 ? targets.map((t) => t.text) : seg.paragraphs.map((p) => p.text);
      for (const txt of texts) {
        for (const ch of txt) {
          if (srcSet.has(ch)) count++;
        }
      }
      rep.matchCount = count;
      return rep;
    }
    rep.matchCount = await this.backend.applyTransliterate(tabId, expr.pattern, expr.replacement, targets);
    return rep;
  }
}

function resolveTargetTabs(proj: DocumentProjection, expr: Expression, defaultTabId: string): string[] {
  const scope = expr.container;
  if (!scope) {
    return [defaultTabId];
  }
  if (scope.all) {
    return proj.tabs.length > 0 ? proj.tabs.map((t) => t.tabId || t.title) : [defaultTabId];
  }
  if (scope.name) {
    return [scope.name];
  }
  if (scope.address) {
    const total = proj.tabs.length;
    if (total === 0) throw new Error("document has no containers");
    const start = scope.address.start === -1 ? total : scope.address.start;
    const end = !scope.address.hasRange
      ? start
      : scope.address.end === -1
        ? total
        : scope.address.end;
    if (start < 1 || start > total || end < 1 || end > total || end < start) {
      throw new Error(`container address out of range (document has ${total} containers)`);
    }
    const ids: string[] = [];
    for (let i = start - 1; i < end; i++) {
      ids.push(proj.tabs[i]!.tabId || proj.tabs[i]!.title);
    }
    return ids;
  }
  return [defaultTabId];
}

export function execute(backend: Backend, program: Program, opts: ExecuteOptions = {}): Promise<ExecutionReport> {
  return new Executor(backend).execute(program, opts);
}
