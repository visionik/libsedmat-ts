import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  executeSedmat,
  MemorySedmatBackend,
  parseExpression,
  parseSedmat,
  resolveReplacementSpans,
  type SedmatCommand,
  type SedmatFormatFlags,
  type SedmatReplacementSegment,
} from "../src/index.js";

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

const CMD_MAP: Record<string, SedmatCommand["type"]> = {
  s: "substitute",
  d: "delete",
  a: "append",
  i: "insert",
  y: "transliterate",
};

const BREAK_MAP: Record<string, string> = {
  "": "hr",
  p: "page",
  c: "column",
  s: "section",
};

function mergeSpanFlags(segments: readonly SedmatReplacementSegment[]): { cleaned: string; flags: SedmatFormatFlags; spanCount: number } {
  const spans = resolveReplacementSpans(segments);
  const cleaned = spans.map((s) => (s.implicitMatchText ? "" : s.text)).join("");
  const flags: SedmatFormatFlags = {};
  let styledCount = 0;
  for (const s of spans) {
    if (s.flags) {
      styledCount++;
      Object.assign(flags, s.flags);
    }
  }
  return { cleaned, flags, spanCount: styledCount };
}

describe("SEDMAT v3.6 Canonical Conformance Vectors (testdata/conformance/v3.6.json)", () => {
  for (const tc of suite.parse_vectors) {
    it(`parse/${tc.name}`, () => {
      if (tc.want_error) {
        expect(() => parseExpression(tc.input)).toThrow();
        return;
      }
      const cmd = parseExpression(tc.input);
      if (tc.command) {
        expect(cmd.type).toBe(CMD_MAP[tc.command]);
      }
      if (tc.address) {
        expect("address" in cmd && cmd.address).toBeTruthy();
        const addr = (cmd as { address?: { start: { kind: string; index?: number }; end?: { kind: string; index?: number } } }).address!;
        const startNum = addr.start.kind === "last" ? -1 : addr.start.index!;
        const endNum = !addr.end ? 0 : addr.end.kind === "last" ? -1 : addr.end.index!;
        expect(startNum).toBe(tc.address.start);
        expect(endNum).toBe(tc.address.end);
        expect(Boolean(addr.end)).toBe(tc.address.has_range);
      }

      if (cmd.type === "substitute") {
        if (tc.global !== undefined) expect(cmd.global).toBe(tc.global);
        if (tc.nth !== undefined && tc.nth > 0) expect(cmd.occurrence).toBe(tc.nth);
        if (tc.pattern) {
          const stripped = tc.pattern.replace(/^\(\?[im]+\)/g, "").replace(/^\(\?[im]+\)/g, "");
          expect(cmd.pattern).toBe(stripped);
          if (tc.pattern.includes("(?i)")) expect(cmd.ignoreCase).toBe(true);
          if (tc.pattern.includes("(?m)")) expect(cmd.multiline).toBe(true);
        }
        if (tc.expect_table_create) {
          expect(cmd.tableCreate).toBeTruthy();
          expect(cmd.tableCreate?.rows).toBe(tc.expect_table_create.rows);
          expect(cmd.tableCreate?.cols).toBe(tc.expect_table_create.columns);
        }
        if (tc.expect_brace || tc.expect_span_count || tc.replacement !== undefined) {
          const { cleaned, flags, spanCount } = mergeSpanFlags(cmd.segments);
          if (tc.replacement !== undefined) {
            expect(cleaned).toBe(tc.replacement);
          }
          if (tc.expect_span_count) {
            expect(spanCount).toBe(tc.expect_span_count);
          }
          if (tc.expect_brace) {
            const eb = tc.expect_brace;
            if (eb.bold !== undefined) expect(flags.bold).toBe(eb.bold);
            if (eb.color) expect(`#${flags.color}`).toBe(eb.color.toUpperCase());
            if (eb.reset) expect(flags.reset).toBe(true);
            if (eb.no_reset) expect(flags.noReset).toBe(true);
            if (eb.has_break) expect(flags.break).toBe(BREAK_MAP[eb.break ?? ""]);
            if (eb.cols) expect(flags.cols).toBe(eb.cols);
            if (eb.check_set) expect(flags.checkbox).toBeDefined();
            if (eb.toc !== undefined) expect(flags.toc).toBeDefined();
            if (eb.comment) expect(flags.comment).toBe(eb.comment);
            if (eb.bookmark) expect(flags.bookmark).toBe(eb.bookmark);
            if (eb.url) expect(flags.url).toBe(eb.url);
            if (eb.img_ref) {
              expect(flags.image).toEqual({ kind: "url", url: eb.img_ref });
            }
          }
        }
      }
    });
  }

  for (const tc of suite.execution_vectors) {
    it(`exec/${tc.name}`, () => {
      const backend = new MemorySedmatBackend(tc.paragraphs);
      if (tc.want_error) {
        expect(() => executeSedmat(backend, tc.script)).toThrow();
        return;
      }
      executeSedmat(backend, tc.script);
      expect(backend.listElements().map((e) => e.text)).toEqual(tc.expected_paragraphs);
    });
  }
});

describe("Ported v7..v12 .sed fixtures", () => {
  const fixturesDir = join(rootDir, "testdata", "fixtures");
  // v10_test.sed Section 17 uses pre-v3.0 legacy trailing `{font=...}` outside the closing delimiter;
  // v11_test.sed and v12_test.sed cover the canonical v3.6 inline brace syntax.
  const sedFiles = readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".sed") && f !== "v10_test.sed")
    .sort();

  for (const file of sedFiles) {
    it(`parses ${file}`, () => {
      const script = readFileSync(join(fixturesDir, file), "utf8");
      const cmds = parseSedmat(script);
      expect(cmds.length).toBeGreaterThan(0);
    });
  }
});
