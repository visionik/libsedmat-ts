#!/usr/bin/env bun
/**
 * Launch-a-Web SEDMAT Document Playground (zero dependencies).
 *
 * Serves an interactive browser UI with:
 * - Live numbered document view + applied formatting spans
 * - SEDMAT command bar with syntax highlighting, IntelliSense dropdown, color swatches & ghost text
 * - Live dry-run preview & structured error diagnostics
 *
 * Run: bun run examples/doc-playground/server.ts
 */

import {
  executeSedmat,
  extractSedmatDiagnostic,
  getSedmatCompletions,
  inspectNumbered,
  MemorySedmatBackend,
  tokenizeSedmat,
} from "../../src/index.js";

const PORT = Number(process.env.PORT ?? 4173);

function createInitialBackend(): MemorySedmatBackend {
  return new MemorySedmatBackend([
    "SEDMAT v3.7 Interactive Document",
    "This paragraph contains a TODO item and a critical warning.",
    "DRAFT: delete this scratch note with 3d or d/DRAFT/",
    "Closing summary ready for formatting and appends.",
  ]);
}

let backend = createInitialBackend();

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>libsedmat-ts — Document Playground</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1120; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; }
    .app { width: min(920px, 94vw); display: grid; gap: 16px; padding: 24px 0; }
    h1 { margin: 0; font-size: 20px; display: flex; justify-content: space-between; align-items: center; }
    .badge { font-size: 12px; background: #1e293b; color: #38bdf8; padding: 4px 10px; border-radius: 999px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 16px; }
    .cmd-row { display: flex; gap: 8px; }
    input { flex: 1; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, monospace; font-size: 14px; }
    button { background: #2563eb; color: white; border: 0; border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer; }
    button.secondary { background: #334155; }
    .tokens { font-family: ui-monospace, monospace; font-size: 13px; margin-top: 8px; min-height: 22px; }
    .tok-scope { color: #c084fc; } .tok-address { color: #fbbf24; } .tok-command { color: #38bdf8; font-weight: 700; }
    .tok-pattern { color: #f472b6; } .tok-brace { color: #4ade80; } .tok-flag { color: #fb923c; } .tok-delimiter { color: #64748b; }
    .status { font-size: 13px; margin-top: 8px; }
    .ok { color: #4ade80; } .err { color: #f87171; }
    .suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .sug { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 10px; height: 10px; border-radius: 2px; border: 1px solid #475569; }
    pre { margin: 0; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="app">
    <h1><span>libsedmat-ts — Document Playground</span><span class="badge">Zero-Dep SEDMAT v3.7</span></h1>
    <div class="card">
      <div class="cmd-row">
        <input id="cmd" value="2s/TODO/{b c=red}/g" placeholder="Type SEDMAT expression (e.g. 1s/.*/{h=t}/ or 2s/TODO/{b c=red}/g)" />
        <button id="apply">Apply</button>
        <button id="reset" class="secondary">Reset</button>
      </div>
      <div id="tokens" class="tokens"></div>
      <div id="status" class="status"></div>
      <div id="suggestions" class="suggestions"></div>
    </div>
    <div class="card">
      <h3 style="margin:0 0 10px;font-size:13px;color:#94a3b8;text-transform:uppercase;">Numbered Document (cat -N)</h3>
      <pre id="doc"></pre>
    </div>
  </div>
  <script>
    const cmdEl = document.getElementById("cmd");
    const tokensEl = document.getElementById("tokens");
    const statusEl = document.getElementById("status");
    const sugEl = document.getElementById("suggestions");
    const docEl = document.getElementById("doc");

    async function refreshDoc() {
      const res = await fetch("/api/state").then(r => r.json());
      docEl.textContent = res.numbered;
    }

    async function inspectCmd() {
      const input = cmdEl.value;
      const cursor = cmdEl.selectionStart ?? input.length;
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, cursor }),
      }).then(r => r.json());

      tokensEl.innerHTML = res.tokens.map(t =>
        '<span class="tok-' + t.kind + '">' + t.text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</span>'
      ).join("") + (res.completions.ghostSuffix ? '<span style="opacity:.4">' + res.completions.ghostSuffix + '</span>' : "");

      statusEl.className = "status " + (res.diagnostic.ok ? "ok" : "err");
      statusEl.textContent = res.diagnostic.ok
        ? "✓ " + res.diagnostic.summary
        : "✗ " + res.diagnostic.summary + (res.diagnostic.hint ? " — " + res.diagnostic.hint : "");

      sugEl.innerHTML = "";
      for (const s of res.completions.suggestions.slice(0, 8)) {
        const btn = document.createElement("button");
        btn.className = "sug";
        btn.innerHTML = (s.swatch ? '<span class="swatch" style="background:' + s.swatch + '"></span>' : "") +
          "<strong>" + s.label + "</strong> <span style='opacity:.7'>" + s.detail + "</span>";
        btn.onclick = () => {
          cmdEl.value = input.slice(0, s.replaceFrom) + s.insertText + input.slice(s.replaceTo);
          cmdEl.focus();
          inspectCmd();
        };
        sugEl.appendChild(btn);
      }
    }

    document.getElementById("apply").onclick = async () => {
      await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: cmdEl.value }),
      });
      await refreshDoc();
      await inspectCmd();
    };
    document.getElementById("reset").onclick = async () => {
      await fetch("/api/reset", { method: "POST" });
      await refreshDoc();
    };
    cmdEl.addEventListener("input", inspectCmd);
    cmdEl.addEventListener("keyup", inspectCmd);
    refreshDoc();
    inspectCmd();
  </script>
</body>
</html>`;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/api/state") {
      return Response.json({ numbered: inspectNumbered(backend) });
    }
    if (url.pathname === "/api/reset" && req.method === "POST") {
      backend = createInitialBackend();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/inspect" && req.method === "POST") {
      const { input = "", cursor = input.length } = (await req.json()) as { input?: string; cursor?: number };
      const completions = getSedmatCompletions(input, cursor, { mode: "document" });
      const tokens = tokenizeSedmat(input);
      let diagnostic: { ok: boolean; summary: string; hint?: string } = { ok: true, summary: "Ready" };
      if (input.trim()) {
        try {
          const preview = executeSedmat(backend, input, { dryRun: true });
          diagnostic = { ok: true, summary: `Dry-run matched ${preview.matchCount} operation(s)` };
        } catch (err) {
          diagnostic = extractSedmatDiagnostic(err);
        }
      }
      return Response.json({ completions, tokens, diagnostic });
    }
    if (url.pathname === "/api/apply" && req.method === "POST") {
      const { input = "" } = (await req.json()) as { input?: string };
      try {
        const res = executeSedmat(backend, input);
        return Response.json({ ok: true, matchCount: res.matchCount, numbered: inspectNumbered(backend) });
      } catch (err) {
        return Response.json({ ok: false, diagnostic: extractSedmatDiagnostic(err) }, { status: 400 });
      }
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`SEDMAT Document Playground running at http://127.0.0.1:${server.port}`);
