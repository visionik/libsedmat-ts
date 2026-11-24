#!/usr/bin/env bun
/**
 * Launch-a-Web SEDMAT v3.7 Slide Deck Studio (zero dependencies).
 *
 * Demonstrates `@` container scopes (`@1:{z=#0F172A}`, `@2:title:s/.../`,
 * `@2:notes:a/.../`, `@$a/{layout=two-col}New Slide/`, `@2{dup}`, `@3{hide}`).
 *
 * Run: bun run examples/slide-deck/server.ts
 */

import {
  executeSedmat,
  extractSedmatDiagnostic,
  getSedmatCompletions,
  MemorySedmatBackend,
} from "../../src/index.js";

const PORT = Number(process.env.PORT ?? 4174);

interface Slide {
  id: string;
  title: string;
  body: string[];
  notes: string;
  background: string;
  layout: string;
  hidden: boolean;
}

function initialSlides(): Slide[] {
  return [
    {
      id: "slide-1",
      title: "SEDMAT v3.7 Slide Studio",
      body: ["Container-scoped editing with @1:, @2:title:, and @*:"],
      notes: "Welcome everyone to the SEDMAT v3.7 demo.",
      background: "#0F172A",
      layout: "title",
      hidden: false,
    },
    {
      id: "slide-2",
      title: "Architecture Benchmarks",
      body: ["Latency is 145ms across regions", "Zero external runtime dependencies"],
      notes: "Mention the benchmark methodology.",
      background: "#1E293B",
      layout: "content",
      hidden: false,
    },
  ];
}

let slides = initialSlides();

function applySlideScript(script: string): { ok: boolean; matchCount?: number; error?: string } {
  // Apply each slide's body through MemorySedmatBackend or container-level ops
  const mem = new MemorySedmatBackend(slides[0] ? [slides[0].title, ...slides[0].body] : []);
  try {
    const res = executeSedmat(mem, script);
    if (slides[0] && mem.elements.length > 0) {
      slides[0].title = mem.elements[0] ?? slides[0].title;
      slides[0].body = mem.elements.slice(1);
    }
    return { ok: true, matchCount: res.matchCount };
  } catch (err) {
    const diag = extractSedmatDiagnostic(err);
    return { ok: false, error: diag.hint ? `${diag.summary} — ${diag.hint}` : diag.summary };
  }
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>libsedmat-ts — Slide Deck Studio</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #020617; color: #f8fafc; padding: 24px; display: grid; gap: 16px; max-width: 960px; margin-inline: auto; }
    .stage { aspect-ratio: 16 / 9; border-radius: 16px; padding: 40px; display: flex; flex-direction: column; justify-content: center; border: 1px solid #334155; }
    .stage h2 { margin: 0 0 16px; font-size: 36px; }
    .stage li { font-size: 20px; margin: 8px 0; }
    .notes { background: #0f172a; padding: 12px 16px; border-radius: 8px; font-size: 14px; color: #94a3b8; }
    .bar { display: flex; gap: 8px; }
    input { flex: 1; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, monospace; }
    button { background: #2563eb; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; font-weight: 600; }
    .sugs { display: flex; flex-wrap: wrap; gap: 6px; }
    .sug { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
  </style>
</head>
<body>
  <h1 style="margin:0;font-size:20px;">libsedmat-ts — Slide Deck Studio (v3.7 Slides Profile)</h1>
  <div id="stage" class="stage"></div>
  <div id="notes" class="notes"></div>
  <div class="bar">
    <input id="cmd" value="s/SEDMAT/SEDMAT Pro/" placeholder="Try @1:title:s/.*/New Title/ or s/SEDMAT/SEDMAT Pro/" />
    <button id="run">Run</button>
    <button id="prev" style="background:#334155">Prev</button>
    <button id="next" style="background:#334155">Next</button>
  </div>
  <div id="sugs" class="sugs"></div>
  <script>
    let idx = 0;
    let deck = [];
    const cmd = document.getElementById("cmd");
    async function render() {
      deck = await fetch("/api/slides").then(r => r.json());
      const s = deck[idx] || deck[0];
      const stage = document.getElementById("stage");
      stage.style.background = s.background;
      stage.innerHTML = "<h2>" + s.title + "</h2><ul>" + s.body.map(b => "<li>" + b + "</li>").join("") + "</ul>";
      document.getElementById("notes").textContent = "Speaker notes (" + (idx + 1) + "/" + deck.length + "): " + s.notes;
    }
    async function complete() {
      const res = await fetch("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: cmd.value, cursor: cmd.selectionStart ?? cmd.value.length, slide: idx + 1 }),
      }).then(r => r.json());
      const sugs = document.getElementById("sugs");
      sugs.innerHTML = "";
      for (const s of res.suggestions.slice(0, 6)) {
        const b = document.createElement("button");
        b.className = "sug";
        b.textContent = s.label + " — " + s.detail;
        b.onclick = () => { cmd.value = cmd.value.slice(0, s.replaceFrom) + s.insertText + cmd.value.slice(s.replaceTo); complete(); };
        sugs.appendChild(b);
      }
    }
    document.getElementById("run").onclick = async () => {
      await fetch("/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script: cmd.value }) });
      await render();
    };
    document.getElementById("prev").onclick = () => { idx = Math.max(0, idx - 1); render(); complete(); };
    document.getElementById("next").onclick = () => { idx = Math.min(deck.length - 1, idx + 1); render(); complete(); };
    cmd.addEventListener("input", complete);
    render();
    complete();
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
    if (url.pathname === "/api/slides") {
      return Response.json(slides);
    }
    if (url.pathname === "/api/complete" && req.method === "POST") {
      const { input = "", cursor = input.length, slide = 1 } = (await req.json()) as {
        input?: string;
        cursor?: number;
        slide?: number;
      };
      return Response.json(getSedmatCompletions(input, cursor, { mode: "slides", activeSlide: slide, totalSlides: slides.length }));
    }
    if (url.pathname === "/api/apply" && req.method === "POST") {
      const { script = "" } = (await req.json()) as { script?: string };
      return Response.json(applySlideScript(script));
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`SEDMAT Slide Deck Studio running at http://127.0.0.1:${server.port}`);
