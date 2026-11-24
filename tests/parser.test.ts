import { describe, expect, it } from "vitest";
import {
  parseExpression,
  parseSedmat,
  SedmatParseError,
} from "../src/index.js";

describe("SEDMAT v3.6 Expression & Program Parser", () => {
  it("parses addressed and unaddressed commands, flags (g/i/m/N), and alternate delimiters", () => {
    const cmds = parseSedmat(`
      # Comments are ignored
      5d
      3,7d/DRAFT/i
      3,7s/old_term/new_term/gim
      s#http://#https://#2
      $a/{h=2}Final closing line/
      3i/Inserted above 3/
      a/Intro/After intro/i
      i/Conclusion/Before conclusion/m
      1!s|foo|bar|gi
      /TODO/s/TODO/{b c=red}/g
      y/aeiou/AEIOU/
    `);

    expect(cmds).toHaveLength(11);
    expect(cmds[0]).toMatchObject({ type: "delete", address: { start: { kind: "line", index: 5 } } });
    expect(cmds[1]).toMatchObject({
      type: "delete",
      address: { start: { kind: "line", index: 3 }, end: { kind: "line", index: 7 } },
      pattern: "DRAFT",
      ignoreCase: true,
    });
    expect(cmds[2]).toMatchObject({
      type: "substitute",
      global: true,
      ignoreCase: true,
      multiline: true,
    });
    expect(cmds[3]).toMatchObject({
      type: "substitute",
      pattern: "http://",
      replacement: "https://",
      occurrence: 2,
    });
    expect(cmds[4]).toMatchObject({
      type: "append",
      address: { start: { kind: "last" } },
      text: "{h=2}Final closing line",
    });
    expect(cmds[6]).toMatchObject({
      type: "append",
      pattern: "Intro",
      ignoreCase: true,
      text: "After intro",
    });
    expect(cmds[7]).toMatchObject({
      type: "insert",
      pattern: "Conclusion",
      multiline: true,
      text: "Before conclusion",
    });
    expect(cmds[10]).toMatchObject({ type: "transliterate", source: "aeiou", dest: "AEIOU" });
  });

  it("detects positional inserts (^$, ^, $), table targets, table creation, and image targets", () => {
    expect(parseExpression("s/^$/Initial content/")).toMatchObject({ positional: "emptyDoc" });
    expect(parseExpression("s/^/{h=t}Title/")).toMatchObject({ positional: "startOfDoc" });
    expect(parseExpression("s/$/Footer/")).toMatchObject({ positional: "endOfDoc" });
    // Addressed ^ is NOT a document-level positional insert
    expect(parseExpression("5s/^/Prefix: /")).toMatchObject({ positional: undefined });

    expect(parseExpression("s/{T=1!A1}/{b}Header/")).toMatchObject({
      tableTarget: { kind: "cell", table: 1, cell: { row: 1, col: 1 } },
    });
    expect(parseExpression("s/PLACEHOLDER/{T=3x4:header}/")).toMatchObject({
      tableCreate: { kind: "create", rows: 3, cols: 4, header: true },
    });
    expect(parseExpression("s/{img=-1}//")).toMatchObject({
      imageTarget: { kind: "index", index: -1 },
    });
  });

  it("enforces SEDMAT v3.6 strict parse validation rules", () => {
    expect(() => parseExpression("")).toThrow(SedmatParseError);
    expect(() => parseExpression("5")).toThrow(/Address without command/);
    expect(() => parseExpression("$")).toThrow(/Address without command/);
    expect(() => parseExpression("$,5d")).toThrow(/\$ cannot be range start/);
    expect(() => parseExpression("$,$d")).toThrow(/\$ cannot be range start/);
    expect(() => parseExpression("7,3d")).toThrow(/range end \(3\) < start \(7\)/);
    expect(() => parseExpression("3,d")).toThrow(SedmatParseError);
    expect(() => parseExpression("0d")).toThrow(SedmatParseError);
    expect(() => parseExpression("d//")).toThrow(/empty pattern/);
    expect(() => parseExpression("y/abc/xy/")).toThrow(/lengths must match/);
    expect(() => parseExpression("y///")).toThrow(/empty source/);
    expect(() => parseExpression("5a//")).toThrow(SedmatParseError);
  });
});
