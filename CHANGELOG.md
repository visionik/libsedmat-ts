# Changelog

All notable changes to `libsedmat-ts` will be documented in this file.

## [0.1.0] - 2026-11-24

### Added
- Zero-dependency TypeScript implementation of SEDMAT v3.6 + v3.7 (`@` container scopes and slide/shape brace flags).
- Full parser, semantic enricher, canonical `{flags}` brace DSL (including `{0}` reset and `{!0}` additive no-reset), Markdown convenience layer, table/image reference parsers, UTF-16 match/text/address planners, and `formatStructure` / `formatNumbered` introspection.
- Target-agnostic `Backend` interface, `Executor` (with `dryRun` and container/tab scoping), and `MemoryDocument` reference backend.
- Full conformance test suite against `testdata/conformance/v3.6.json`, ported `v7`–`v12` `.sed` fixtures, and v3.7 container scope tests passing under both Node.js and Bun.
