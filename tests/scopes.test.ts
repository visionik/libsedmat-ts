import { describe, expect, it } from "vitest";
import {
  parseBraceFlags,
  parseContainerScope,
  parseExpression,
  parseSedmat,
  SedmatParseError,
} from "../src/index.js";

describe("SEDMAT v3.7 Generic Container Scopes (@) & Slide/Shape Flags", () => {
  it("parses container-level structural and style ops", () => {
    const cmds = parseSedmat(`
      @3d
      @2,4d
      @$d
      @$a/{layout=two-col}Next Steps/
      @2i/{layout=content}Overview/
      @3{move=1}
      @2{dup}
      @4{hide}
      @1:{z=#0F172A}
      @2:{notes="Highlight 120ms latency"}
    `);

    expect(cmds).toHaveLength(10);
    expect(cmds[0]).toMatchObject({
      type: "container",
      op: "delete",
      scope: { target: { kind: "address", address: { start: { kind: "line", index: 3 } } } },
    });
    expect(cmds[1]).toMatchObject({
      type: "container",
      op: "delete",
      scope: {
        target: {
          kind: "address",
          address: { start: { kind: "line", index: 2 }, end: { kind: "line", index: 4 } },
        },
      },
    });
    expect(cmds[3]).toMatchObject({
      type: "container",
      op: "append",
      scope: { target: { kind: "address", address: { start: { kind: "last" } } } },
      text: "{layout=two-col}Next Steps",
    });
    expect(cmds[5]).toMatchObject({
      type: "container",
      op: "style",
      flags: { move: 1 },
    });
    expect(cmds[6]).toMatchObject({
      type: "container",
      op: "style",
      flags: { dup: true },
    });
    expect(cmds[7]).toMatchObject({
      type: "container",
      op: "style",
      flags: { hide: true },
    });
    expect(cmds[8]).toMatchObject({
      type: "container",
      op: "style",
      flags: { bg: "0F172A" },
    });
    expect(cmds[9]).toMatchObject({
      type: "container",
      op: "style",
      flags: { notes: "Highlight 120ms latency" },
    });
  });

  it("parses scoped content commands, named containers, typed assertions, regions, and table/image shorthands", () => {
    const cmds = parseSedmat(`
      @2:s/500ms/{b c=green t=120ms}/g
      @2,5:1,3s/old/new/gi
      @*:s/DRAFT//g
      @Summary:3d
      @"Q4 Budget":s/USD/EUR/g
      @slide=2:title:s/.*/{c=navy}Latency Breakthrough/
      @2:notes:a/Pause here for Q&A./
      @header:s/DRAFT/FINAL/
      @2:{T=1!A1}/{b}Metric/
      @2:{img=1}/{x=480 y=270}/
    `);

    expect(cmds).toHaveLength(10);
    expect(cmds[0]).toMatchObject({
      type: "substitute",
      scope: { target: { kind: "address", address: { start: { kind: "line", index: 2 } } } },
    });
    expect(cmds[1]).toMatchObject({
      type: "substitute",
      scope: {
        target: {
          kind: "address",
          address: { start: { kind: "line", index: 2 }, end: { kind: "line", index: 5 } },
        },
      },
      address: { start: { kind: "line", index: 1 }, end: { kind: "line", index: 3 } },
    });
    expect(cmds[2]).toMatchObject({
      type: "substitute",
      scope: { target: { kind: "all" } },
    });
    expect(cmds[3]).toMatchObject({
      type: "delete",
      scope: { target: { kind: "name", name: "Summary" } },
      address: { start: { kind: "line", index: 3 } },
    });
    expect(cmds[4]).toMatchObject({
      type: "substitute",
      scope: { target: { kind: "name", name: "Q4 Budget" } },
    });
    expect(cmds[5]).toMatchObject({
      type: "substitute",
      scope: {
        containerType: "slide",
        target: { kind: "address", address: { start: { kind: "line", index: 2 } } },
        region: "title",
      },
    });
    expect(cmds[6]).toMatchObject({
      type: "append",
      scope: {
        target: { kind: "address", address: { start: { kind: "line", index: 2 } } },
        region: "notes",
      },
      text: "Pause here for Q&A.",
    });
    expect(cmds[7]).toMatchObject({
      type: "substitute",
      scope: { target: { kind: "regionOnly" }, region: "header" },
    });
    expect(cmds[8]).toMatchObject({
      type: "substitute",
      tableTarget: { kind: "cell", table: 1, cell: { row: 1, col: 1 } },
    });
    expect(cmds[9]).toMatchObject({
      type: "substitute",
      imageTarget: { kind: "index", index: 1 },
    });
  });

  it("parses standalone scope strings and slide/shape brace flags", () => {
    expect(parseContainerScope("@slide=2:notes")).toEqual({
      containerType: "slide",
      target: { kind: "address", address: { start: { kind: "line", index: 2 } } },
      region: "notes",
    });

    expect(
      parseBraceFlags("layout=two-col zone=left shape=roundRect fill=#1E293B stroke=#38BDF8 transition=fade x=1in y=20% w=4in h=2in"),
    ).toEqual({
      layout: "two-col",
      zone: "left",
      shape: "roundRect",
      fill: "1E293B",
      stroke: "38BDF8",
      transition: "fade",
      geomX: "1in",
      width: 1,
      geomY: "20%",
      height: 20,
      geomW: "4in",
      geomH: "2in",
    });

    expect(() => parseExpression("@")).toThrow(SedmatParseError);
    expect(() => parseExpression("@2")).toThrow(/Container scope without command/);
  });
});
