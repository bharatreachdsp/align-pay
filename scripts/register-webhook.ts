/**
 * Creates the app's PayPal webhook, or points it at a new URL, for the events ALIGN Pay reconciles.
 *   tsx scripts/register-webhook.ts https://<tunnel>.trycloudflare.com
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { clientFromEnv, newActionId, upsertWebhook } from "@align-agent/paypal-guard";
import { sqliteStore } from "@align-agent/paypal-guard/store/sqlite";
import { DATA_DIR, DB_FILE, loadEnv } from "./lib/env";

export async function registerWebhook(baseUrl: string): Promise<{ id: string; url: string }> {
  const pp = clientFromEnv();
  const store = sqliteStore(DB_FILE);
  const known = store.getKv<{ id: string }>("webhook");
  const hook = await upsertWebhook(pp, `${baseUrl.replace(/\/$/, "")}/api/paypal/webhook`, known?.id ?? null, `webhook-${newActionId()}`);
  const rec = { id: hook.id, url: hook.url, events: hook.event_types.map((e) => e.name), updatedAt: new Date().toISOString() };
  store.setKv("webhook", rec);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, "webhook.json"), JSON.stringify(rec, null, 2));
  return { id: hook.id, url: hook.url };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx scripts/register-webhook.ts <https://public-base-url>");
    process.exit(1);
  }
  const r = await registerWebhook(url);
  console.log(`Webhook ${r.id} → ${r.url}`);
}
