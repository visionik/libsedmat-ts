# libsedmat-ts

Zero-dependency TypeScript library implementing **[SEDMAT](https://sedmat.org)** (*Sed-Expression-Driven Mark(up|down) Annotation & Transformation*, **v3.6 + v3.7 `@` container scopes**).

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
import { Executor, MemoryDocument, formatNumbered, selectSegment } from "@visionik/libsedmat";

const doc = new MemoryDocument(
  "Draft Proposal",
  "Critical warning in paragraph two",
  "Temporary note to remove",
);

const exec = new Executor(doc);
const script = `
1s/Draft/{h=1}Final/
2s/warning/{b c=red}/
$d
$a/Appendix A/
`;

// Dry-run preview
const preview = await exec.executeString(script, { dryRun: true });
console.log(`Matched ${preview.totalMatches} operations`);

// Apply mutations
await exec.executeString(script);
console.log(formatNumbered(selectSegment(doc.project())));
```

## SEDMAT v3.7 Container Scopes (`@`)

Supports slides, sheets, tabs, pages, and named regions (`title`, `sub`, `body`, `notes`, `header`, `footer`, `shape=N`):

```ts
await exec.executeString(`
@1:{z=#0F172A transition=fade}
@2:s/500ms/{b c=green}120ms/g
@2:{notes="Highlight 120ms WebTransport benchmark"}
@"Q4 Budget":s/USD/EUR/g
@$a/{layout=two-col}Next Steps/
`);
```

## Implementing a Custom Backend

Implement the `Backend` interface (`project`, `applyTextPlan`, `applyAddressMutations`, `applyTableCreate`, `applyTransliterate`, and optional `applyContainerOp`) to connect `libsedmat-ts` to OOXML (`.docx`/`.pptx`), Google Docs, ProseMirror/TipTap, or any rich document model. All offsets are native JS UTF-16 code units.

## Guide for AI Agents

- Inspect first via `project()` → `formatStructure(seg)` or `formatNumbered(seg)` to obtain exact 1-based element indices.
- Validate scripts with `{ dryRun: true }` before mutating.
- Honor `brace.noReset` (`{!0}`) for additive formatting vs. implicit reset default.
- Conformance suite: `testdata/conformance/v3.6.json` (shared with `libsedmat-go`, `libsedmat-rs`, `libsedmat-py`, and `libsedmat-cpp`).

## Development

```bash
make check       # Run Node.js and Bun test suites
npm run test:node
bun test
```

## License

MIT — see [LICENSE](./LICENSE).
