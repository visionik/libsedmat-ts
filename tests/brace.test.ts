import { describe, expect, it } from "vitest";
import {
  expandBackrefs,
  parseBraceFlags,
  parseReplacementSegments,
  resolveReplacementSpans,
  resolveSedmatColor,
} from "../src/index.js";

describe("SEDMAT v3.6 Brace DSL", () => {
  it("parses all canonical boolean flags and negations", () => {
    expect(parseBraceFlags("b i _ - # ^ , w")).toEqual({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      code: true,
      superscript: true,
      subscript: true,
      smallCaps: true,
    });

    expect(parseBraceFlags("!b !i !_ !- !# !^ !, !w")).toEqual({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      superscript: false,
      subscript: false,
      smallCaps: false,
    });
  });

  it("parses canonical value flags, named/hex colors, and bare-flag resets", () => {
    const f = parseBraceFlags(
      'c=red z=#FFFF00 f=Playfair+Display s=18 u=https://example.com l=1.5 a=center o=50 n=36 k=1.2 x=400 y=200 p=12,6 h=2 e=shadow cols=2 t="Hello World"',
    );
    expect(f).toEqual({
      color: "FF0000",
      bg: "FFFF00",
      fontFamily: "Playfair Display",
      fontSizePt: 18,
      url: "https://example.com",
      uri: { kind: "url", href: "https://example.com" },
      leadingPt: 1.5,
      align: "center",
      opacity: 50,
      indentPt: 36,
      kerningPt: 1.2,
      width: 400,
      height: 200,
      spacing: { beforePt: 12, afterPt: 6 },
      heading: "Heading2",
      effect: "shadow",
      cols: 2,
      text: "Hello World",
    });

    // Bare value flags reset to defaults (null); bare `{h}` defaults to Heading1; `{h=0}` resets to Normal
    expect(parseBraceFlags("c z f s u l a o n k x y p e cols")).toEqual({
      color: null,
      bg: null,
      fontFamily: null,
      fontSizePt: null,
      url: null,
      uri: null,
      leadingPt: null,
      align: null,
      opacity: null,
      indentPt: null,
      kerningPt: null,
      width: null,
      height: null,
      spacing: null,
      effect: null,
      cols: 1,
    });

    expect(parseBraceFlags("h")).toEqual({ heading: "Heading1" });
    expect(parseBraceFlags("h=0")).toEqual({ heading: "Normal" });
    expect(parseBraceFlags("h=t")).toEqual({ heading: "Title" });
    expect(parseBraceFlags("h=s")).toEqual({ heading: "Subtitle" });
    expect(parseBraceFlags("h=6")).toEqual({ heading: "Heading6" });
    expect(parseBraceFlags("p=12")).toEqual({ spacing: { beforePt: 12, afterPt: 12 } });
  });

  it("parses reset {0}, no-reset {!0}, breaks {+}, checkboxes {check}, TOC {toc}, comments, bookmarks, and smart chips", () => {
    expect(parseBraceFlags("0 b")).toEqual({ reset: true, bold: true });
    expect(parseBraceFlags("!0 b c=red")).toEqual({ noReset: true, bold: true, color: "FF0000" });
    expect(parseBraceFlags("+")).toEqual({ break: "hr" });
    expect(parseBraceFlags("+=p")).toEqual({ break: "page" });
    expect(parseBraceFlags("+=c")).toEqual({ break: "column" });
    expect(parseBraceFlags("+=s cols=2")).toEqual({ break: "section", cols: 2 });

    expect(parseBraceFlags("check")).toEqual({ checkbox: "unchecked" });
    expect(parseBraceFlags("check=n b")).toEqual({ checkbox: "unchecked", bold: true });
    expect(parseBraceFlags("check=y")).toEqual({ checkbox: "checked" });

    expect(parseBraceFlags("toc")).toEqual({ toc: {} });
    expect(parseBraceFlags("toc=2")).toEqual({ toc: { maxDepth: 2 } });

    expect(parseBraceFlags('"=Please verify Q3 numbers')).toEqual({
      comment: "Please verify Q3 numbers",
    });
    expect(parseReplacementSegments('{b "=Verify thermal spec}')).toEqual([
      { kind: "brace", flags: { bold: true, comment: "Verify thermal spec" } },
    ]);
    expect(parseReplacementSegments('{b "=Verify thermal spec"}')).toEqual([
      { kind: "brace", flags: { bold: true, comment: "Verify thermal spec" } },
    ]);
    expect(parseBraceFlags("@=ch1")).toEqual({ bookmark: "ch1" });
    expect(parseBraceFlags("u=#ch1")).toEqual({
      url: "#ch1",
      uri: { kind: "bookmark", name: "ch1" },
    });
    expect(parseBraceFlags("u=chip://person/alice@example.com")).toEqual({
      url: "chip://person/alice@example.com",
      uri: {
        kind: "chip",
        chip: {
          kind: "person",
          value: "alice@example.com",
          raw: "chip://person/alice@example.com",
        },
      },
    });
  });

  it("resolves all 18 canonical SEDMAT named colors and 3/6-digit hex codes", () => {
    expect(resolveSedmatColor("red")).toBe("FF0000");
    expect(resolveSedmatColor("lightgray")).toBe("D3D3D3");
    expect(resolveSedmatColor("darkgray")).toBe("404040");
    expect(resolveSedmatColor("brown")).toBe("8B4513");
    expect(resolveSedmatColor("magenta")).toBe("FF00FF");
    expect(resolveSedmatColor("#f0a")).toBe("FF00AA");
    expect(resolveSedmatColor("#1a2b3c")).toBe("1A2B3C");
  });

  it("supports flexible brace placement ({b}, {b}text, text{b}, {c=red}text{b}, inline H{,=2}O)", () => {
    // Standalone brace => implicit $0
    expect(resolveReplacementSpans(parseReplacementSegments("{b}"))).toEqual([
      { text: "$0", implicitMatchText: true, flags: { bold: true } },
    ]);

    // Leading brace before text
    expect(resolveReplacementSpans(parseReplacementSegments("{b}hello"))).toEqual([
      { text: "hello", flags: { bold: true } },
    ]);

    // Trailing brace after text
    expect(resolveReplacementSpans(parseReplacementSegments("hello{b}"))).toEqual([
      { text: "hello", flags: { bold: true } },
    ]);

    // Surrounding braces merge onto text
    expect(resolveReplacementSpans(parseReplacementSegments("{c=red}warning{b}"))).toEqual([
      { text: "warning", flags: { color: "FF0000", bold: true } },
    ]);

    // Inline scoping: H{,=2}O and E=mc{^=2}
    expect(resolveReplacementSpans(parseReplacementSegments("H{,=2}O"))).toEqual([
      { text: "H", flags: undefined },
      { text: "2", flags: { subscript: true, text: "2", inlineScoped: true } },
      { text: "O", flags: undefined },
    ]);

    expect(resolveReplacementSpans(parseReplacementSegments("{b=Warning}: check logs"))).toEqual([
      { text: "Warning", flags: { bold: true, text: "Warning", inlineScoped: true } },
      { text: ": check logs", flags: undefined },
    ]);

    // Escaped braces stay literal
    expect(resolveReplacementSpans(parseReplacementSegments("\\{literal\\}"))).toEqual([
      { text: "{literal}", flags: undefined },
    ]);
  });

  it("expands $0, &, $1-$9, \\1-\\9, $$, and \\& backreferences accurately", () => {
    const m = /(\w+)=(\d+)/.exec("price=42")!;
    expect(expandBackrefs("$1 -> $$\\1 (& / \\&)", m)).toBe("price -> $price (price=42 / &)");
    expect(expandBackrefs("${1}:${2} ($0)", m)).toBe("price:42 (price=42)");
  });
});
