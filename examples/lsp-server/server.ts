#!/usr/bin/env bun
/**
 * Zero-dependency SEDMAT Language Server (LSP over stdio).
 *
 * Supports:
 * - initialize / shutdown / exit
 * - textDocument/didOpen, textDocument/didChange -> publishDiagnostics
 * - textDocument/completion (profile-aware IntelliSense + color swatches)
 * - textDocument/signatureHelp (live SEDMAT grammar hints)
 * - textDocument/semanticTokens/full (lossless SEDMAT syntax tokens)
 *
 * Run: bun run examples/lsp-server/server.ts
 */

import {
  extractSedmatDiagnostic,
  getSedmatCompletions,
  parseSedmat,
  tokenizeSedmat,
  type SedmatSuggestionKind,
  type SedmatTokenKind,
} from "../../src/index.js";

const TOKEN_TYPES: SedmatTokenKind[] = [
  "comment",
  "scope",
  "address",
  "command",
  "delimiter",
  "pattern",
  "brace",
  "text",
  "flag",
  "whitespace",
];

const LSP_TOKEN_LEGEND = [
  "comment",
  "namespace",
  "number",
  "keyword",
  "operator",
  "regexp",
  "decorator",
  "string",
  "modifier",
  "variable",
];

const docs = new Map<string, string>();
let shutdownRequested = false;

function sendMessage(payload: Record<string, unknown>): void {
  const body = JSON.stringify({ jsonrpc: "2.0", ...payload });
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
  process.stdout.write(header + body);
}

function kindToLspCompletion(kind: SedmatSuggestionKind): number {
  switch (kind) {
    case "scope":
      return 9; // Module
    case "command":
      return 14; // Keyword
    case "flag":
      return 10; // Property
    case "value":
      return 12; // Value
    case "snippet":
      return 15; // Snippet
  }
}

function offsetToLineChar(text: string, offset: number): { line: number; character: number } {
  const safe = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  let lastNl = -1;
  for (let i = 0; i < safe; i++) {
    if (text[i] === "\n") {
      line++;
      lastNl = i;
    }
  }
  return { line, character: safe - (lastNl + 1) };
}

function lineCharToOffset(text: string, line: number, character: number): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    offset += lines[i]!.length + 1;
  }
  const targetLine = lines[line] ?? "";
  return Math.min(text.length, offset + Math.min(character, targetLine.length));
}

function publishDiagnostics(uri: string, text: string): void {
  const diagnostics: Array<Record<string, unknown>> = [];
  const lines = text.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    try {
      parseSedmat(trimmed);
    } catch (err) {
      const diag = extractSedmatDiagnostic(err);
      const col = diag.errorOffset ?? 0;
      const len = Math.max(1, diag.errorLength ?? 1);
      diagnostics.push({
        range: {
          start: { line: lineIdx, character: col },
          end: { line: lineIdx, character: col + len },
        },
        severity: 1,
        source: "libsedmat",
        message: diag.hint ? `${diag.summary} — ${diag.hint}` : diag.summary,
      });
    }
  }
  sendMessage({
    method: "textDocument/publishDiagnostics",
    params: { uri, diagnostics },
  });
}

function encodeSemanticTokens(text: string): number[] {
  const tokens = tokenizeSedmat(text);
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const tok of tokens) {
    if (tok.kind === "whitespace" || tok.text.includes("\n")) continue;
    const pos = offsetToLineChar(text, tok.start);
    const deltaLine = pos.line - prevLine;
    const deltaStart = deltaLine === 0 ? pos.character - prevChar : pos.character;
    const typeIdx = Math.max(0, TOKEN_TYPES.indexOf(tok.kind));
    data.push(deltaLine, deltaStart, tok.end - tok.start, typeIdx, 0);
    prevLine = pos.line;
    prevChar = pos.character;
  }
  return data;
}

function handleMessage(msg: {
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
}): void {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      sendMessage({
        id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            completionProvider: { triggerCharacters: ["{", "@", "/", "=", ":", " "] },
            signatureHelpProvider: { triggerCharacters: ["/", "{", "="] },
            semanticTokensProvider: {
              legend: { tokenTypes: LSP_TOKEN_LEGEND, tokenModifiers: [] },
              full: true,
            },
          },
          serverInfo: { name: "libsedmat-ts-lsp", version: "0.1.0" },
        },
      });
      break;

    case "initialized":
      break;

    case "shutdown":
      shutdownRequested = true;
      sendMessage({ id, result: null });
      break;

    case "exit":
      process.exit(shutdownRequested ? 0 : 1);
      break;

    case "textDocument/didOpen": {
      const td = params?.textDocument;
      if (td?.uri && typeof td.text === "string") {
        docs.set(td.uri, td.text);
        publishDiagnostics(td.uri, td.text);
      }
      break;
    }

    case "textDocument/didChange": {
      const uri = params?.textDocument?.uri;
      const changes = params?.contentChanges;
      if (uri && Array.isArray(changes) && changes.length > 0) {
        const text = String(changes[changes.length - 1]?.text ?? "");
        docs.set(uri, text);
        publishDiagnostics(uri, text);
      }
      break;
    }

    case "textDocument/completion": {
      const uri = params?.textDocument?.uri;
      const pos = params?.position;
      const text = docs.get(uri) ?? "";
      const lineText = text.split("\n")[pos?.line ?? 0] ?? "";
      const cursor = Math.min(lineText.length, pos?.character ?? 0);
      const res = getSedmatCompletions(lineText, cursor, { mode: "all" });
      const items = res.suggestions.map((s) => ({
        label: s.label,
        kind: kindToLspCompletion(s.kind),
        detail: s.swatch ? `${s.detail} (${s.swatch})` : s.detail,
        textEdit: {
          range: {
            start: { line: pos?.line ?? 0, character: s.replaceFrom },
            end: { line: pos?.line ?? 0, character: s.replaceTo },
          },
          newText: s.insertText,
        },
      }));
      sendMessage({ id, result: { isIncomplete: false, items } });
      break;
    }

    case "textDocument/signatureHelp": {
      const uri = params?.textDocument?.uri;
      const pos = params?.position;
      const text = docs.get(uri) ?? "";
      const lineText = text.split("\n")[pos?.line ?? 0] ?? "";
      const cursor = Math.min(lineText.length, pos?.character ?? 0);
      const res = getSedmatCompletions(lineText, cursor, { mode: "all" });
      const label = res.signature.map((p) => p.text).join("");
      const activeIdx = Math.max(0, res.signature.findIndex((p) => p.active));
      sendMessage({
        id,
        result: {
          signatures: [
            {
              label,
              documentation: res.contextTitle,
              parameters: res.signature.map((p) => ({ label: p.text })),
            },
          ],
          activeSignature: 0,
          activeParameter: activeIdx,
        },
      });
      break;
    }

    case "textDocument/semanticTokens/full": {
      const uri = params?.textDocument?.uri;
      const text = docs.get(uri) ?? "";
      sendMessage({ id, result: { data: encodeSemanticTokens(text) } });
      break;
    }

    default:
      if (id !== undefined) {
        sendMessage({ id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
      break;
  }
}

// Stdio Content-Length JSON-RPC reader
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const headerStr = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const contentLength = Number.parseInt(match[1]!, 10);
    const totalLen = headerEnd + 4 + contentLength;
    if (buffer.length < totalLen) break;
    const bodyStr = buffer.subarray(headerEnd + 4, totalLen).toString("utf8");
    buffer = buffer.subarray(totalLen);
    try {
      handleMessage(JSON.parse(bodyStr));
    } catch {
      // Ignore malformed JSON frames
    }
  }
});

// Export helper check for unused warning silence
void lineCharToOffset;
