import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  enrich,
  Executor,
  formatNumbered,
  formatStructure,
  MemoryDocument,
  parse,
  parseProgram,
  selectSegment,
} from "../src/index.ts";

interface ConformanceSuite {
  spec: string;
  version: string;
  parse_vectors: Array<{
    name: string;
    input: string;
    want_error?: boolean;
    command?: string;
    pattern?: string;
    replacement?: string;
    global?: boolean;
    nth?: number;
    address?: { start: number; end: number; has_range: boolean };
    expect_brace?: {
      bold?: boolean;
      color?: string;
      reset?: boolean;
      no_reset?: boolean;
      has_break?: boolean;
      break?: string;
      cols?: number;
      check_set?: boolean;
      toc?: number;
      comment?: string;
      bookmark?: string;
      url?: string;
      img_ref?: string;
    };
    expect_span_count?: number;
    expect_table_create?: { rows: number; columns: number };
  }>;
  execution_vectors: Array<{
    name: string;
    paragraphs: string[];
    script: string;
    expected_paragraphs?: string[];
    want_error?: boolean;
  }>;
}

const rootDir = join(import.meta.dirname, "..");
const suite: ConformanceSuite = JSON.parse(
  readFileSync(join(rootDir, "testdata", "conformance", "v3.6.json"), "utf8"),
);

describe("SEDMAT v3.6 Conformance Vectors (JSON)", () => {
  for (const tc of suite.parse_vectors) {
    it(`parse/${tc.name}`, () => {
      if (tc.want_error) {
        assert.throws(() => enrich(parse(tc.input)));
        return;
      }
      const prog = enrich(parse(tc.input));
      assert.equal(prog.expressions.length, 1);
      const expr = prog.expressions[0]!;
      if (tc.command !== undefined) assert.equal(expr.command, tc.command);
      if (tc.pattern !== undefined) assert.equal(expr.pattern, tc.pattern);
      if (tc.replacement !== undefined) assert.equal(expr.replacement, tc.replacement);
      if (tc.global !== undefined) assert.equal(expr.global, tc.global);
      if (tc.nth !== undefined && tc.nth > 0) assert.equal(expr.nthMatch, tc.nth);
      if (tc.address) {
        assert.ok(expr.address, "expected address");
        assert.equal(expr.address.start, tc.address.start);
        assert.equal(expr.address.end, tc.address.end);
        assert.equal(expr.address.hasRange, tc.address.has_range);
      }
      if (tc.expect_span_count) {
        assert.equal(expr.braceSpans?.length ?? 0, tc.expect_span_count);
      }
      if (tc.expect_table_create) {
        assert.ok(expr.tableCreate, "expected tableCreate");
        assert.equal(expr.tableCreate.rows, tc.expect_table_create.rows);
        assert.equal(expr.tableCreate.columns, tc.expect_table_create.columns);
      }
      if (tc.expect_brace) {
        const b = expr.brace;
        assert.ok(b, "expected brace");
        const eb = tc.expect_brace;
        if (eb.bold !== undefined) assert.equal(b.bold, eb.bold);
        if (eb.color) assert.equal(b.color?.toUpperCase(), eb.color.toUpperCase());
        if (eb.reset) assert.equal(b.reset, true);
        if (eb.no_reset) assert.equal(b.noReset, true);
        if (eb.has_break) {
          assert.equal(b.hasBreak, true);
          assert.equal(b.breakKind, eb.break);
        }
        if (eb.cols) assert.equal(b.cols, eb.cols);
        if (eb.check_set) assert.notEqual(b.check, undefined);
        if (eb.toc !== undefined) assert.equal(b.toc, eb.toc);
        if (eb.comment) assert.equal(b.comment, eb.comment);
        if (eb.bookmark) assert.equal(b.bookmark, eb.bookmark);
        if (eb.url) assert.equal(b.url, eb.url);
        if (eb.img_ref) assert.equal(b.imgRef, eb.img_ref);
      }
    });
  }

  for (const tc of suite.execution_vectors) {
    it(`exec/${tc.name}`, async () => {
      const doc = new MemoryDocument(...tc.paragraphs);
      const exec = new Executor(doc);
      if (tc.want_error) {
        await assert.rejects(() => exec.executeString(tc.script));
        return;
      }
      await exec.executeString(tc.script);
      assert.deepEqual(doc.paragraphTexts(), tc.expected_paragraphs);
    });
  }
});

describe("Ported v7..v12 .sed fixtures", () => {
  const fixturesDir = join(rootDir, "testdata", "fixtures");
  const sedFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".sed")).sort();

  for (const file of sedFiles) {
    it(`parses ${file}`, () => {
      const script = readFileSync(join(fixturesDir, file), "utf8");
      const prog = parseProgram(script);
      assert.ok(prog.expressions.length > 0, `expected expressions in ${file}`);
    });
  }
});

describe("SEDMAT v3.7 Container Scopes (@) & Memory Backend", () => {
  it("parses and executes container-scoped edits, regions, and container ops", async () => {
    const doc = new MemoryDocument("Slide 1 Title", "Draft subtitle");
    doc.tabs[0]!.id = "slide-1";
    doc.tabs[0]!.title = "Intro";
    doc.addTab("slide-2", "Metrics", "Latency is 500ms", "Keep this line");
    doc.addTab("slide-3", "Q4 Budget", "Total in USD");

    const exec = new Executor(doc);
    await exec.executeString(`
@1:{z=#0F172A transition=fade}
@2:s/500ms/{b c=green}120ms/g
@2:{notes="Highlight 120ms WebTransport benchmark"}
@"Q4 Budget":s/USD/EUR/g
@$a/{layout=two-col}Next Steps/
@4{hide}
`);

    assert.equal(doc.tabs[0]!.background, "#0F172A");
    assert.equal(doc.tabs[0]!.transition, "fade");
    assert.deepEqual(doc.paragraphTexts("slide-2"), ["Latency is 120ms", "Keep this line"]);
    assert.equal(doc.tabs[1]!.notes, "Highlight 120ms WebTransport benchmark");
    assert.deepEqual(doc.paragraphTexts("Q4 Budget"), ["Total in EUR"]);
    assert.equal(doc.tabs.length, 4);
    assert.equal(doc.tabs[3]!.title, "Next Steps");
    assert.equal(doc.tabs[3]!.hidden, true);
  });

  it("supports typed container scopes, regions, dry-run, tables, and introspection", async () => {
    const prog = parseProgram(`
@slide=2:title:s/.*/{c=navy}New Title/
@2:notes:a/Pause for Q&A./
@header:s/DRAFT/FINAL/
@3{move=1}
@2{dup}
`);
    assert.equal(prog.expressions.length, 5);
    assert.equal(prog.expressions[0]!.container?.containerType, "slide");
    assert.equal(prog.expressions[0]!.container?.region, "title");
    assert.equal(prog.expressions[1]!.container?.region, "notes");
    assert.equal(prog.expressions[2]!.container?.region, "header");
    assert.equal(prog.expressions[3]!.brace?.move, 1);
    assert.equal(prog.expressions[4]!.brace?.dup, true);

    const doc = new MemoryDocument("PLACEHOLDER", "Body line");
    const exec = new Executor(doc);
    const dry = await exec.executeString("2s/Body/Updated/", { dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.totalMatches, 1);
    assert.equal(doc.plainText(), "PLACEHOLDER\nBody line");

    await exec.executeString(`
s/PLACEHOLDER/| Name | Role |\\n| Alice | Admin |/
s/|1|[2,2]/Owner/
`);
    assert.equal(doc.tables()[0]!.rows[1]![1], "Owner");

    const seg = selectSegment(doc.project());
    assert.ok(formatStructure(seg).includes("[1] table (2x2)"));
    assert.ok(formatNumbered(seg).includes("[2] Body line"));
  });
});
