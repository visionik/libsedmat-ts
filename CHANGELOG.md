# Changelog

All notable changes to `libsedmat-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-24

### Added
- Zero-dependency TypeScript implementation of SEDMAT v3.6 + v3.7 (`@` container scopes and slide/shape brace flags), rebased on `@voxio/sedmat` from `deftai/voxio2`.
- Full parser (`parseSedmat`, `parseBraceFlags`, `parseContainerScope`, `parseReplacementSpans`), canonical `sedmat.org` 18-color palette (`SEDMAT_NAMED_COLORS`, `resolveSedmatColor`), Markdown convenience layer, table/image/chip helpers, and `inspectStructure` / `inspectNumbered` introspection.
- Target-agnostic `SedmatBackend` interface, `executeSedmat` (with `dryRun` and container/region scoping), and `MemorySedmatBackend` reference backend.
- UI-agnostic IntelliSense engine (`src/intellisense.ts`):
  - `getSedmatCompletions` with capability profiles (`document`/`word`, `slides`, `spreadsheet`, `vector`, `timeline`, `all`), semicolon-chained command awareness, live grammar signatures, inline `ghostSuffix`, canonical color swatches, and host extension hooks.
  - `extractSedmatDiagnostic` returning structured error offset, span length, summary, and actionable hint.
  - `tokenizeSedmat` non-throwing lossless syntax tokenizer.
- Conformance test suite against `testdata/conformance/v3.6.json`, ported `v7`–`v12` `.sed` fixtures, v3.7 container scopes, and IntelliSense tests (90 tests passing under Bun).
