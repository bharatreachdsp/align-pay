/**
 * `tsx scripts/assets.ts`: the thumbnail (submission/thumbnail.png, 1800×1200) and the two-page overview PDF
 * (submission/ALIGN-Pay-overview.pdf), both rendered from HTML with Playwright.
 *   --key AL-12     the D1 decision key for the thumbnail's receipt stub (default: read from the running app)
 */
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { STORE_RULE_STATEMENTS, normaliseStatement } from "@align-agent/paypal-guard";
import { MODELS, PAYPAL_APIS, PRINCIPLE, judgeSteps } from "./lib/content";
import { REPO_ROOT, loadEnv } from "./lib/env";

loadEnv();
const OUT = join(REPO_ROOT, "submission");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.ALIGN_PAY_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function d1Key(): Promise<string> {
  const i = process.argv.indexOf("--key");
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  try {
    const s = (await (await fetch(`${BASE}/api/state`)).json()) as { policies: { decisionKey: string; statement: string }[] };
    const p = s.policies.find((x) => normaliseStatement(x.statement) === normaliseStatement(STORE_RULE_STATEMENTS[0]));
    if (p) return p.decisionKey;
  } catch {
    // app not running
  }
  throw new Error("Could not find D1's key: run the app, or pass --key AL-n");
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Fraunces:ital,wght@0,600;0,700;1,600&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">`;

const mark = (size: number, stroke = 2.6) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <path d="M3 5 C 11 5, 12 12.5, 19 12.5 L 29 12.5" stroke="#b4532f" stroke-width="${stroke}" stroke-linecap="round"/>
  <path d="M3 16 L 29 16" stroke="#b4532f" stroke-width="${stroke}" stroke-linecap="round"/>
  <path d="M3 27 C 11 27, 12 19.5, 19 19.5 L 29 19.5" stroke="#b4532f" stroke-width="${stroke}" stroke-linecap="round"/></svg>`;

function thumbnailHtml(key: string): string {
  return `<!doctype html><html><head>${FONTS}<style>
  body{margin:0;width:1800px;height:1200px;background:#f6efe3;font-family:'DM Sans',sans-serif;color:#1f1a16;position:relative;overflow:hidden}
  .paper{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(180,83,47,.035) 0 1px,transparent 1px 34px)}
  .left{position:absolute;left:120px;top:230px;width:900px}
  .word{font-family:Fraunces,serif;font-weight:700;font-size:128px;letter-spacing:.06em;line-height:1;margin-top:34px;white-space:nowrap}
  .word span{color:#b4532f;letter-spacing:0;margin-left:14px;font-weight:600}
  .tag{font-size:44px;line-height:1.25;color:#4a4038;margin-top:40px;max-width:780px}
  .principle{font-family:Fraunces,serif;font-style:italic;font-size:32px;margin-top:44px;border-left:5px solid #b4532f;padding-left:24px;color:#1f1a16;max-width:760px}
  .stub{position:absolute;right:120px;top:170px;width:560px;background:#fffaf1;border:2px solid #e1d4bf;border-radius:6px 6px 20px 20px;box-shadow:0 30px 60px -30px rgba(31,26,22,.35);padding:56px 48px 150px;transform:rotate(2.5deg)}
  .stub:before{content:"";position:absolute;left:0;right:0;top:-14px;height:28px;background:radial-gradient(circle at 14px 0,#f6efe3 12px,transparent 12.5px) repeat-x;background-size:32px 28px}
  .mono{font-family:'JetBrains Mono',monospace}
  .row{display:flex;justify-content:space-between;font-size:27px;margin:12px 0}
  .muted{color:#7b6e62}
  .rule{border-top:2px dashed #cdbca3;border-bottom:2px dashed #cdbca3;padding:22px 0;margin:24px 0}
  .key{display:inline-block;background:#1f1a16;color:#f6efe3;border-radius:8px;padding:6px 16px;font-size:34px;font-weight:700}
  .quote{font-family:Fraunces,serif;font-style:italic;font-size:30px;line-height:1.3;margin-top:18px}
  .stamp{position:absolute;right:44px;bottom:40px;transform:rotate(-8deg);border:5px solid #b4532f;color:#b4532f;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:32px;letter-spacing:.14em;padding:10px 22px;border-radius:10px;background:rgba(243,220,205,.55)}
  .foot{position:absolute;left:120px;bottom:70px;font-size:26px;color:#7b6e62}
  </style></head><body><div class="paper"></div>
  <div class="left">${mark(150, 2.8)}<div class="word">ALIGN<span>Pay</span></div>
  <div class="tag">Every refund and invoice your AI agent makes in PayPal, traced to a human decision.</div>
  <div class="principle">${PRINCIPLE}</div></div>
  <div class="stub">
    <div class="row"><span class="mono" style="font-weight:700">REFUND</span><span class="mono">$180.00</span></div>
    <div class="row muted"><span>Kettle &amp; Kesar (fictional)</span><span class="mono">sandbox</span></div>
    <div class="rule"><div class="muted" style="font-size:24px;margin-bottom:12px">Decision</div><span class="key mono">${key}</span>
    <div class="quote">“${STORE_RULE_STATEMENTS[0]}”</div></div>
    <div class="row"><span class="muted">Captured (PayPal)</span><span class="mono">$180.00</span></div>
    <div class="row"><span class="muted">Approved by</span><span>the store owner</span></div>
    <div class="row"><span class="muted">Webhook</span><span class="mono" style="color:#2f6b4f">verified</span></div>
    <div class="stamp">${key} · APPROVED</div>
  </div>
  <div class="foot">Built on ALIGN · PayPal sandbox · open source (MIT)</div>
  </body></html>`;
}

function pdfHtml(): string {
  const svg = readFileSync(join(REPO_ROOT, "docs", "architecture.svg"), "utf8").replace("<svg ", '<svg style="width:100%;height:auto" ');
  const steps = judgeSteps({ clientId: "", secret: "", public: true });
  return `<!doctype html><html><head>${FONTS}<style>
  @page{size:A4;margin:11mm 12mm}
  body{font-family:'DM Sans',sans-serif;color:#1f1a16;font-size:9.4pt;line-height:1.36;margin:0}
  h1{font-family:Fraunces,serif;font-size:19pt;margin:0 0 4pt;letter-spacing:-.01em;line-height:1.15}
  h2{font-family:Fraunces,serif;font-size:12.5pt;margin:9pt 0 4pt}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:8pt}
  .brand b{font-family:Fraunces,serif;font-size:15pt;letter-spacing:.08em}.brand b span{color:#b4532f;letter-spacing:0;margin-left:3px}
  .pitch{font-size:10.5pt;color:#4a4038;margin:4pt 0}
  .principle{font-family:Fraunces,serif;font-style:italic;font-size:12.5pt;border-left:3px solid #b4532f;padding-left:10px;margin:8pt 0}
  table{width:100%;border-collapse:collapse;font-size:8.8pt}
  td{border-bottom:1px solid #e1d4bf;padding:3.2pt 5pt;vertical-align:top}
  td:first-child{font-weight:600;white-space:nowrap;width:28%}
  ol{padding-left:15pt;margin:3pt 0}li{margin:2pt 0}
  .page{page-break-after:always}
  .small{font-size:8.6pt;color:#7b6e62}
  .strip{background:#1f1a16;color:#f6efe3;font-size:8.5pt;padding:4pt 8pt;border-radius:4px;display:inline-block;margin-bottom:8pt}
  </style></head><body>
  <section class="page">
    <div class="brand">${mark(26)}<b>ALIGN<span>Pay</span></b></div>
    <div class="strip">Fictional store · PayPal sandbox · no real money</div>
    <h1>Every refund and invoice your AI agent makes in PayPal traces back to a human decision.</h1>
    <p class="pitch">ALIGN Pay is an open-source guard between an AI agent and PayPal, built on ALIGN, the decision ledger for teams that build software with AI agents. The demo reads the store's four rules from a Sample ALIGN ledger in the repository.</p>
    <p class="principle">${PRINCIPLE} The model never decides whether money moves.</p>
    <h2>Architecture</h2>
    ${svg}
    <h2>What happens on a refund</h2>
    <ol>
      <li>The support agent (Gemini) calls <b>refund_order</b>. ALIGN Pay turns the call into an action with its own id.</li>
      <li>The guard reads the facts from PayPal, never from the agent: capture, refunds so far, open disputes, the customer's refunds in 30 days.</li>
      <li>It evaluates the limits the store owner confirmed from his ALIGN decisions (Gemini drafted them; he clicked Confirm): block beats hold beats allow; missing facts, no decision or an unknown tool hold.</li>
      <li>Allowed: ALIGN Pay refunds through its own PayPal client, idempotent on the action id, with the decision key on the refund. Held: the owner approves or declines; approval re-reads PayPal first. Blocked: the agent is told why, quoting the decision.</li>
      <li>PayPal's signed webhook confirms what settled; the audit traces every refund and invoice to a decision, and flags anything else as untraced.</li>
    </ol>
  </section>
  <section>
    <h2>How PayPal is used</h2>
    <table>${PAYPAL_APIS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
    <h2>How AI is used</h2>
    <table>${MODELS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
    <h2>Try it (judge steps)</h2>
    <ol>${steps.map((s) => `<li>${s.replace(/&/g, "&amp;")}</li>`).join("")}</ol>
    <p class="small">Repository: github.com/bharatreachdsp/align-pay (MIT). ALIGN: align.bharatreachdsp.com · CLI and MCP server: github.com/bharatreachdsp/align-cli. Built by Sakuraj Technologies, Jaipur.</p>
  </section>
  </body></html>`;
}

const browser = await chromium.launch();
try {
  const only = process.argv.includes("--pdf-only") ? "pdf" : process.argv.includes("--thumbnail-only") ? "thumb" : "both";
  if (only !== "pdf") {
    const key = await d1Key();
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
    await page.setContent(thumbnailHtml(key), { waitUntil: "networkidle" });
    await page.screenshot({ path: join(OUT, "thumbnail.png") });
    console.log(`thumbnail.png (${(statSync(join(OUT, "thumbnail.png")).size / 1e6).toFixed(2)} MB, key ${key})`);
  }
  if (only !== "thumb") {
    const page = await browser.newPage();
    await page.setContent(pdfHtml(), { waitUntil: "networkidle" });
    await page.pdf({ path: join(OUT, "ALIGN-Pay-overview.pdf"), format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" } });
    console.log(`ALIGN-Pay-overview.pdf (${(statSync(join(OUT, "ALIGN-Pay-overview.pdf")).size / 1e6).toFixed(2)} MB)`);
  }
} finally {
  await browser.close();
}
