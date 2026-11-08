/**
 * Seed data for the audit: three fictional seed orders on the card path, then one refund made directly through
 * PayPal's REST API, bypassing ALIGN Pay, so the audit has something to flag as untraced. Run once; it remembers.
 *
 *   pnpm seed            # creates them if they do not exist yet
 *   pnpm seed --force    # creates a fresh set
 */
import { clientFromEnv, createCardOrder, newActionId, orderMoney, refundCapture } from "@align-agent/paypal-guard";
import { sqliteStore } from "@align-agent/paypal-guard/store/sqlite";
import { DB_FILE, loadEnv, requireEnv } from "./lib/env";

loadEnv();
requireEnv(["PAYPAL_ENV", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
const pp = clientFromEnv();
const store = sqliteStore(DB_FILE);

const existing = store.getKv<{ createdAt: string; outsideRefund: { id: string } }>("seed");
if (existing && !process.argv.includes("--force")) {
  console.log(`Seed data already exists (created ${existing.createdAt}; outside refund ${existing.outsideRefund.id}).`);
  process.exit(0);
}

const seeds = [
  { customerId: "asha-SEED", sku: "KK-CHAI", name: "Kesar Chai Blend", unitUsd: 18 },
  { customerId: "ben-SEED", sku: "KK-DARJ", name: "Darjeeling First Flush", unitUsd: 26 },
  { customerId: "chen-SEED", sku: "KK-KETTLE", name: "Brass Tea Kettle", unitUsd: 64 },
];

const orders: { orderId: string; captureId: string; customerId: string }[] = [];
for (const s of seeds) {
  const order = await createCardOrder(pp, {
    customId: s.customerId,
    description: "Kettle & Kesar (fictional store) seed order",
    items: [{ name: s.name, sku: s.sku, quantity: 1, unitUsd: s.unitUsd }],
    requestId: `seed-${newActionId()}`,
  });
  const m = orderMoney(order);
  if (order.status !== "COMPLETED" || !m.capture) throw new Error(`Seed order ${order.id} did not complete (${order.status}).`);
  store.putOrder({
    orderId: order.id,
    captureId: m.capture.id,
    customerId: s.customerId,
    items: [{ sku: s.sku, name: s.name, quantity: 1, unitUsd: s.unitUsd }],
    totalUsd: s.unitUsd,
    createdAt: new Date().toISOString(),
    source: "seed",
    label: "seed order",
  });
  orders.push({ orderId: order.id, captureId: m.capture.id, customerId: s.customerId });
  console.log(`Seed order ${order.id} (${s.name}, $${s.unitUsd}) captured: ${m.capture.id}`);
}

// The outside refund: straight to PayPal's Payments API, no guard, no action, no decision.
const target = orders[1]!;
const refund = await refundCapture(pp, {
  captureId: target.captureId,
  amountUsd: 26,
  requestId: `outside-${newActionId()}`,
  noteToPayer: "Refund made directly in PayPal",
});
console.log(`Outside refund ${refund.id} (${refund.status}) on capture ${target.captureId}, made directly in PayPal, outside ALIGN Pay.`);

store.setKv("seed", {
  createdAt: new Date().toISOString(),
  orders,
  outsideRefund: { id: refund.id, captureId: target.captureId, orderId: target.orderId, at: new Date().toISOString() },
});
