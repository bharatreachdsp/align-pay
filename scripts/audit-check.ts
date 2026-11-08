/**
 * `tsx scripts/audit-check.ts`: runs the audit on the running app and checks it against ALIGN Pay's own records:
 * the outside refund (seed) is untraced, every guard-executed refund older than three hours is traced, and the store's
 * payments show as incoming. Writes .data/audit-check.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditReport } from "@align-agent/paypal-guard";
import { sqliteStore } from "@align-agent/paypal-guard/store/sqlite";
import { DATA_DIR, DB_FILE, loadEnv } from "./lib/env";

loadEnv();
const BASE = process.env.ALIGN_PAY_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const store = sqliteStore(DB_FILE);
const report = (await (await fetch(`${BASE}/api/audit`, { method: "POST" })).json()) as AuditReport;
const byId = new Map(report.rows.map((r) => [r.id, r]));
const lines: string[] = [];
let ok = report.transactionSearch === "active";
lines.push(`Transaction Search: ${report.transactionSearch}; counts ${JSON.stringify(report.counts)}; ran ${report.ranAt}.`);

const seed = store.getKv<{ outsideRefund: { id: string } }>("seed");
const outside = seed ? byId.get(seed.outsideRefund.id) : undefined;
const outsideOk = outside?.cls === "untraced";
ok &&= outsideOk;
lines.push(`Outside refund ${seed?.outsideRefund.id ?? "?"} (made directly in PayPal): ${outside ? `${outside.cls}, "${outside.label}"` : "not listed yet"}.`);

const lag = 3 * 60 * 60 * 1000;
const old = store
  .listActions({ type: "refund.create", status: "executed" })
  .filter((a) => a.paypalId && Date.now() - Date.parse(a.executedAt ?? a.updatedAt) > lag);
const tracedOld = old.filter((a) => byId.get(a.paypalId!)?.cls === "traced");
ok &&= old.length > 0 && tracedOld.length === old.length;
lines.push(
  `Guard-executed refunds older than 3 hours: ${old.length}; traced: ${tracedOld.length}. ${old
    .slice(0, 6)
    .map((a) => `${a.paypalId} → ${byId.get(a.paypalId!)?.label ?? "not listed"}`)
    .join("; ")}`,
);

const orders = store.listOrders().filter((o) => o.captureId && Date.now() - Date.parse(o.createdAt) > lag);
const incoming = orders.filter((o) => byId.get(o.captureId!)?.cls === "incoming");
ok &&= orders.length > 0 && incoming.length === orders.length;
lines.push(`Store payments older than 3 hours: ${orders.length}; shown as incoming payments matched to their order: ${incoming.length}.`);

const out = { ranAt: new Date().toISOString(), ok, evidence: lines.join("\n") };
writeFileSync(join(DATA_DIR, "audit-check.json"), JSON.stringify(out, null, 2));
console.log(`${ok ? "PASS" : "NOT YET"}\n${out.evidence}`);
