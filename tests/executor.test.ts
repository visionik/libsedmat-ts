import { describe, expect, it } from "vitest";
import {
  executeSedmat,
  inspectNumbered,
  inspectStructure,
  MemorySedmatBackend,
  SedmatAddressError,
} from "../src/index.js";

describe("SEDMAT v3.6 Generic Executor & MemorySedmatBackend", () => {
  it("executes addressed edits, flexible braces, dry-run, and introspection", () => {
    const backend = new MemorySedmatBackend([
      "Project Plan",
      "Intro paragraph with draft wording.",
      "Body item one",
      "DRAFT: internal scratch note",
      "Closing paragraph",
    ]);

    expect(inspectNumbered(backend)).toContain("[1] Project Plan");
    expect(inspectStructure(backend)).toContain("1  paragraph:Normal  Project Plan");

    // Dry-run MUST NOT mutate the backend
    const preview = executeSedmat(backend, "4d\n2s/draft/{b c=green}final/i", { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.matchCount).toBe(2);
    expect(backend.elements).toHaveLength(5);

    // Apply for real
    const res = executeSedmat(
      backend,
      [
        "1s/.*/{h=t}/",
        "2s/draft/{c=green}final{b}/i",
        "4d",
        "$a/{h=2}Appendix/",
        "1i/Banner/",
      ].join("\n"),
    );

    expect(res.ok).toBe(true);
    expect(res.commandCount).toBe(5);
    expect(res.matchCount).toBe(5);
    expect(backend.listElements().map((e) => e.text)).toEqual([
      "Banner",
      "Project Plan",
      "Intro paragraph with final wording.",
      "Body item one",
      "Closing paragraph",
      "Appendix",
    ]);
    expect(backend.listElements()[1]?.style).toBe("Title");
    expect(backend.listElements()[5]?.style).toBe("Heading2");
  });

  it("enforces strict out-of-range and empty-document address errors", () => {
    const backend = new MemorySedmatBackend(["Only one"]);
    expect(() => executeSedmat(backend, "5d")).toThrow(SedmatAddressError);
    expect(() => executeSedmat(backend, "1,5d")).toThrow(/out of range/);

    const empty = new MemorySedmatBackend([]);
    expect(() => executeSedmat(empty, "$d")).toThrow(/no addressable elements/);
  });

  it("executes positional inserts (^$, ^, $), tables, images, comments, and transliteration", () => {
    const backend = new MemorySedmatBackend([]);
    // Empty doc positional insert works
    expect(executeSedmat(backend, "s/^$/Seed line/").matchCount).toBe(1);
    // Second ^$ is a no-op since doc is no longer empty
    expect(executeSedmat(backend, "s/^$/Ignored/").matchCount).toBe(0);

    // Prepend + append + create table + populate cells + add row + transliterate
    executeSedmat(
      backend,
      [
        "s/^/Header/",
        "s/$/{T=2x2:header}/",
        "s/{T=1!A1}/Metric/",
        "s/{T=1!B1}/Value/",
        "s/{T=1!2,1}/Latency/",
        "s/{T=1!2,2}/120ms/",
        "s/{T=1!row=$+}//",
        "1y/aeiou/AEIOU/",
      ].join("\n"),
    );

    const els = backend.listElements();
    expect(els[0]?.text).toBe("HEAdEr");
    expect(els[2]?.kind).toBe("table");
    expect(els[2]?.meta).toBe("3x2");
    expect(els[2]?.text).toContain("Metric");
    expect(els[2]?.text).toContain("120ms");

    // Delete table with {T=1}//
    executeSedmat(backend, "s/{T=1}//");
    expect(backend.listElements().some((e) => e.kind === "table")).toBe(false);
  });
});
