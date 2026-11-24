# libsedmat-ts

Zero-dependency TypeScript library implementing **[SEDMAT](https://sedmat.org)** (*Sed-Expression-Driven Mark(up|down) Annotation & Transformation*, **v3.6 + v3.7 `@` container scopes**), extracted from `@voxio/sedmat` in [`deftai/voxio2`](https://github.com/deftai/voxio2) and aligned with the canonical `sedmat.org` specification.

For full language syntax, flags, and container scope documentation, see **[sedmat.org](https://sedmat.org)** and [`visionik/sedmat`](https://github.com/visionik/sedmat).

## Installation

```bash
npm install @visionik/libsedmat
# or
bun add @visionik/libsedmat
```

Requires Node.js 22+ or Bun 1.1+. **Zero runtime dependencies.**

## Quick Start

```ts
import {
  executeSedmat,
  inspectNumbered,
  inspectStructure,
  MemorySedmatBackend,
} from "@visionik/libsedmat";

const backend = new MemorySedmatBackend([
  "Project Plan",
  "Intro paragraph with draft wording.",
  "DRAFT: internal scratch note",
  "Closing paragraph",
]);

// 1. Inspect with 1-based numbering (`structure` / `cat -N`)
console.log(inspectStructure(backend));
console.log(inspectNumbered(backend));

// 2. Preview safely with dry-run
const script = `
1s/.*/{h=t}/
2s/draft/{c=green}final{b}/i
3d
$a/{h=2}Appendix/
`;
const preview = executeSedmat(backend, script, { dryRun: true });
console.log(`Dry-run matched ${preview.matchCount} operations`);

// 3. Apply mutations
executeSedmat(backend, script);
console.log(inspectNumbered(backend));
```

## SEDMAT v3.7 Container Scopes (`@`)

Implement `SedmatBackend.forScope(scope)` and `applyContainerOp(cmd, spans)` to target slides, sheets, tabs, pages, headers/footers, and named regions (`title`, `sub`, `body`, `notes`, `shape=N`):

```ts
import { parseSedmat } from "@visionik/libsedmat";

const cmds = parseSedmat(`
@1:{z=#0F172A transition=fade}
@slide=2:title:s/.*/{c=navy}New Title/
@2:notes:a/Pause for Q&A./
@"Q4 Budget":s/USD/EUR/g
@$a/{layout=two-col}Next Steps/
@3{move=1}
`);
```

## IntelliSense, Diagnostics & Syntax Tokenizer

`libsedmat-ts` includes a UI-agnostic, zero-dependency IntelliSense engine for web command bars, TUIs, CLIs, and LSPs:

```ts
import {
  extractSedmatDiagnostic,
  getSedmatCompletions,
  tokenizeSedmat,
} from "@visionik/libsedmat";

// 1. Cursor-aware completions with capability profiles & host extensions
const res = getSedmatCompletions("s/foo/{c=re", 11, {
  mode: "slides",
  activeContainer: 2,
});
// res.suggestions[0] => { label: "red", swatch: "#FF0000", ... }
// res.ghostSuffix    => "d"

// 2. Non-throwing syntax tokenizer for highlighting
const tokens = tokenizeSedmat("@2:title:s/foo/{b c=red}bar/gi");

// 3. Structured diagnostics from any thrown SEDMAT error
try {
  // parseSedmat(...)
} catch (err) {
  const diag = extractSedmatDiagnostic(err); // { ok, summary, errorOffset, errorLength, hint }
}
```

## Implementing a Custom Backend

Implement `SedmatBackend` (`listElements`, `replaceInElement`, `deleteElements`, `insertElements`, `transliterateElement`, plus optional `applyPositionalInsert`, `applyTableOp`, `applyImageOp`, `applyContainerFlags`, `forScope`, `applyContainerOp`). See [`src/memory.ts`](./src/memory.ts) for a complete reference backend.

## Guide for AI Agents

- Inspect first via `inspectStructure(backend)` or `inspectNumbered(backend)` to get exact 1-based indices.
- Validate scripts with `executeSedmat(backend, script, { dryRun: true })` before mutating.
- Honor `flags.reset` (`{0}`) vs. `flags.noReset` (`{!0}`) for reset vs. additive formatting.
- Named colors follow the canonical `sedmat.org` 18-color hex palette (`red` = `FF0000`, `green` = `00FF00`, etc.).
- Conformance suite: `testdata/conformance/v3.6.json` (shared across Go, TS, Rust, Python, and C++).

## Development

```bash
make check   # bun test (90 tests across 7 suites)
```

## Related

- **SEDMAT Website & Docs**: [https://sedmat.org](https://sedmat.org)
- **SEDMAT Specification**: [https://github.com/visionik/sedmat](https://github.com/visionik/sedmat)
- **Sibling Libraries**: [`libsedmat-go`](https://github.com/visionik/libsedmat-go) · [`libsedmat-rs`](https://github.com/visionik/libsedmat-rs) · [`libsedmat-py`](https://github.com/visionik/libsedmat-py) · [`libsedmat-cpp`](https://github.com/visionik/libsedmat-cpp)

## License

MIT — see [LICENSE](./LICENSE).
