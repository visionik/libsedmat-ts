import { describe, expect, it } from "vitest";
import {
  extractSedmatDiagnostic,
  getSedmatCompletions,
  parseExpression,
  SEDMAT_NAMED_COLORS,
  tokenizeSedmat,
} from "../src/index.js";

describe("SEDMAT IntelliSense, Diagnostics & Tokenizer", () => {
  it("extracts structured offset, length, reason, and hint from SedmatParseError", () => {
    let caught: unknown;
    try {
      parseExpression("$,3d");
    } catch (err) {
      caught = err;
    }
    const diag = extractSedmatDiagnostic(caught);
    expect(diag.ok).toBe(false);
    expect(diag.summary).toContain("$ cannot be range start");
    expect(typeof diag.errorOffset).toBe("number");
  });

  it("completes brace flags and canonical sedmat.org color swatches inside {...}", () => {
    const flagRes = getSedmatCompletions("s/foo/{!0", 9, { mode: "document" });
    expect(flagRes.suggestions.some((s) => s.label === "!0")).toBe(true);

    const colorRes = getSedmatCompletions("s/foo/{c=r", 10, { mode: "document" });
    const redOpt = colorRes.suggestions.find((s) => s.label === "red");
    expect(redOpt).toBeDefined();
    expect(redOpt?.swatch).toBe(`#${SEDMAT_NAMED_COLORS.red}`);
    expect(colorRes.ghostSuffix).toBe("ed");
  });

  it("completes @ container scopes, slide regions, and supports custom host extensions", () => {
    const scopeRes = getSedmatCompletions("@2:ti", 5, { mode: "slides", activeSlide: 2 });
    expect(scopeRes.suggestions[0]?.label).toBe("title:");
    expect(scopeRes.ghostSuffix).toBe("tle:");

    const customRes = getSedmatCompletions("s/x/{my", 7, {
      mode: "document",
      extensions: {
        flags: [{ key: "myflag=", insert: "myflag=", detail: "Custom host flag" }],
      },
    });
    expect(customRes.suggestions[0]?.label).toBe("myflag=");
  });

  it("highlights active substitution parameter and suggests trailing flags", () => {
    const patRes = getSedmatCompletions("s/foo", 5);
    expect(patRes.signature.find((p) => p.active)?.text).toBe("pattern");

    const repRes = getSedmatCompletions("s/foo/bar", 9);
    expect(repRes.signature.find((p) => p.active)?.text).toContain("replacement");

    const flagRes = getSedmatCompletions("s/foo/bar/g", 11);
    expect(flagRes.suggestions.map((s) => s.label)).toEqual(["i", "m", "2"]);
  });

  it("tokenizes SEDMAT expressions cleanly without throwing", () => {
    const tokens = tokenizeSedmat('@2:title:s/old/{b c=red}new/gi');
    expect(tokens.some((t) => t.kind === "scope" && t.text === "@2:title:")).toBe(true);
    expect(tokens.some((t) => t.kind === "command" && t.text === "s")).toBe(true);
    expect(tokens.some((t) => t.kind === "pattern" && t.text === "old")).toBe(true);
    expect(tokens.some((t) => t.kind === "brace" && t.text === "{b c=red}")).toBe(true);
    expect(tokens.some((t) => t.kind === "flag" && t.text === "gi")).toBe(true);
  });
});
