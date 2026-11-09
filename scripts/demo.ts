/**
 * `pnpm demo`: everything ALIGN Pay needs, on this machine.
 *
 * 1. Refuses to start unless PAYPAL_ENV=sandbox.
 * 2. Builds and starts the app on http://localhost:3000 (`--dev` runs the dev server instead).
 * 3. The ledger is the Sample ALIGN ledger (ledger/sample-ledger.json); ALIGN_PAY_LEDGER=align connects a live ALIGN
 *    workspace through `align mcp` instead. The banner says which.
 * 4. If cloudflared is installed: a quick tunnel, and the PayPal webhook pointed at it (the URL changes every run).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { assertSandboxEnv } from "@align-agent/paypal-guard";
import { DATA_DIR, REPO_ROOT, loadEnv, requireEnv } from "./lib/env";
import { registerWebhook } from "./register-webhook";
import { hasCloudflared, startTunnel } from "./tunnel";

loadEnv();
requireEnv(["PAYPAL_ENV", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
try {
  assertSandboxEnv();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.warn("! GOOGLE_GENERATIVE_AI_API_KEY is not set: the support agent and limit drafting will not work.");
}

const dev = process.argv.includes("--dev");
const noTunnel = process.argv.includes("--no-tunnel") || process.env.ALIGN_PAY_NO_TUNNEL === "1";
const port = Number(process.env.PORT ?? 3000);
mkdirSync(DATA_DIR, { recursive: true });

const env = { ...process.env, ALIGN_PAY_ROOT: REPO_ROOT, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" };
const children: ChildProcess[] = [];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

if (!dev) {
  console.log("Building the app (about a minute the first time)…");
  const b = spawnSync("pnpm", ["--filter", "@align-pay/web", "exec", "next", "build"], { env, stdio: ["ignore", "ignore", "inherit"] });
  if (b.status !== 0) {
    console.error("The build failed; see above.");
    process.exit(1);
  }
}
// Bound to 127.0.0.1: nothing else on the network can reach it. The tunnel (if any) forwards only PayPal's webhooks.
const app = spawn("pnpm", ["--filter", "@align-pay/web", "exec", "next", dev ? "dev" : "start", "-H", "127.0.0.1", "-p", String(port)], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});
children.push(app);
app.on("exit", (code) => {
  console.error(`The app stopped (${code}).`);
  stop();
});

async function waitForApp(): Promise<{ ledger: { label: string; note: string | null } } | null> {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/state`);
      if (r.ok) return (await r.json()) as { ledger: { label: string; note: string | null } };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

const first = await waitForApp();
if (!first) {
  console.error("The app did not start.");
  stop();
}

let webhookLine = "webhooks: off (cloudflared is not installed; receipts stay at \"awaiting PayPal's webhook\" and the audit uses Transaction Search alone)";
let tunnel: { url: string; child: ChildProcess } | null = null;

/** Starts a quick tunnel and points the PayPal webhook at it. */
async function openTunnel(): Promise<string> {
  const t = await startTunnel(port);
  tunnel = t;
  children.push(t.child);
  const hook = await registerWebhook(t.url);
  return `webhooks: ${hook.url} (webhook ${hook.id})`;
}

/** Quick tunnels can stop answering (sleep, network change): check every few minutes and replace a dead one. */
async function watchTunnel() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 4 * 60_000));
    if (!tunnel) continue;
    const alive = await fetch(`${tunnel.url}/api/paypal/webhook`, { method: "POST", body: "{}", signal: AbortSignal.timeout(15_000) })
      .then((r) => r.status === 400)
      .catch(() => false);
    if (alive) continue;
    console.warn("! The tunnel stopped answering; opening a new one and pointing the PayPal webhook at it.");
    tunnel.child.kill();
    try {
      console.log(await openTunnel());
    } catch (e) {
      console.warn(`! Could not reopen the tunnel: ${(e as Error).message}`);
    }
  }
}

if (noTunnel) webhookLine = "webhooks: off (--no-tunnel)";
else if (hasCloudflared()) {
  try {
    webhookLine = await openTunnel();
    void watchTunnel();
  } catch (e) {
    webhookLine = `webhooks: off (${(e as Error).message})`;
  }
}

// Wait for the first ledger sync, so the banner can say which ledger is on.
let state = first;
for (let i = 0; i < 90 && state && /connecting/.test(state.ledger.label); i++) {
  await new Promise((r) => setTimeout(r, 1000));
  state = await waitForApp();
}

console.log(`
  ┌──────────────────────────────────────────────────────────────
  │ ALIGN Pay is running: http://localhost:${port}
  │ ${state?.ledger.label ?? "Ledger: unknown"}${state?.ledger.note ? ` (${state.ledger.note})` : ""}
  │ ${webhookLine}
  │ Fictional store · PayPal sandbox · no real money
  │ Open the page: "Review and confirm the store's rules", then "Start a demo". Ctrl+C stops everything.
  └──────────────────────────────────────────────────────────────
`);
