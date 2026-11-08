/**
 * Sandbox tests: real calls to the PayPal sandbox. Opt-in: `pnpm test:sandbox` (needs .env or .env.local at the repo
 * root). Orders here carry custom_id "kk-sandbox-test-…", so the audit labels them as tests, not store traffic.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { newActionId } from "../src/actions";
import { kettleAndKesar } from "../src/directory";
import { PayPalExecutor } from "../src/execute";
import { PayPalFacts } from "../src/facts";
import { Guard } from "../src/guard";
import { clientFromEnv, type PayPalClient, PayPalError, silentLogger } from "../src/paypal/client";
import { listDisputes } from "../src/paypal/disputes";
import { deleteInvoice, getInvoice, invoiceFactsOf } from "../src/paypal/invoices";
import { createCardOrder, getOrder, orderMoney } from "../src/paypal/orders";
import { getRefund } from "../src/paypal/refunds";
import { searchTransactions } from "../src/paypal/transactions";
import { listWebhooks, verifyWebhookSignature } from "../src/paypal/webhooks";
import { memoryStore } from "../src/store/memory";
import { policy } from "./helpers";

const root = join(__dirname, "..", "..", "..");
for (const f of [".env", ".env.local"]) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, '$1');
  }
}
const ready = !!process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_ENV === "sandbox";
const TEST_POLICIES = [0, 1, 2, 3].map((i) => policy(i, { decisionKey: `TEST-${i + 1}` }));

describe.skipIf(!ready)("PayPal sandbox", () => {
  let pp: PayPalClient;
  let orderId = "";
  const tag = `kk-sandbox-test-${Date.now().toString(36)}`;

  beforeAll(() => {
    pp = clientFromEnv(process.env, silentLogger);
  });

  it("issues a token", async () => {
    expect((await pp.accessToken()).length).toBeGreaterThan(20);
  });

  it("captures a card order in one call (the card path)", async () => {
    const order = await createCardOrder(pp, {
      customId: tag,
      description: "ALIGN Pay sandbox test (fictional)",
      items: [{ name: "Kesar Chai Blend", quantity: 2, unitUsd: 15 }],
      requestId: `test-${newActionId()}`,
    });
    expect(order.status).toBe("COMPLETED");
    const m = orderMoney(order);
    expect(m.capture?.status).toBe("COMPLETED");
    expect(m.capturedUsd).toBe(30);
    expect(m.customId).toBe(tag);
    orderId = order.id;
  });

  it("reads the facts from PayPal and refunds through the guard, annotated and idempotent", async () => {
    const store = memoryStore();
    const facts = new PayPalFacts({ paypal: pp, store, directory: kettleAndKesar(), useTransactionSearch: false });
    const executor = new PayPalExecutor(pp);
    const guard = new Guard({ store, facts, executor, policies: { current: async () => ({ ledger: { available: true }, policies: TEST_POLICIES }) } });

    const f = await facts.facts({ id: newActionId(), type: "refund.create", requestedBy: "test", customerId: tag, args: {}, target: { orderId }, requested: {} });
    expect(f.kind === "refund" && f.remainingUsd).toBe(30);
    expect(f.kind === "refund" && f.openDisputes).toBe(0);

    const action = { id: newActionId(), type: "refund.create" as const, requestedBy: "sandbox-test", customerId: tag, args: {}, target: { orderId }, requested: { amountUsd: 5 } };
    const r = await guard.handle(action);
    expect(r.status).toBe("allowed");
    const refund = await getRefund(pp, r.paypalId!);
    expect(refund.custom_id).toBe(action.id);
    expect(refund.note_to_payer).toBe("Refund under Kettle and Kesar policy TEST-1");

    // Executing the same action id again at PayPal returns the same refund (PayPal-Request-Id).
    const rec = store.getAction(action.id)!;
    const again = await executor.execute(rec, f, rec.verdict);
    expect(again.paypalId).toBe(r.paypalId);
    expect(orderMoney(await getOrder(pp, orderId)).refundedUsd).toBe(5);

    // More than what is left: blocked, no PayPal call.
    const big = await guard.handle({ ...action, id: newActionId(), requested: { amountUsd: 40 } });
    expect(big.status).toBe("blocked");
    expect(orderMoney(await getOrder(pp, orderId)).refundedUsd).toBe(5);
  });

  it("creates an invoice through the guard with the decision on its memo, and reads its facts", async () => {
    const store = memoryStore();
    const facts = new PayPalFacts({ paypal: pp, store, directory: kettleAndKesar(), useTransactionSearch: false });
    const guard = new Guard({ store, facts, executor: new PayPalExecutor(pp), policies: { current: async () => ({ ledger: { available: true }, policies: TEST_POLICIES }) } });
    const r = await guard.handle({
      id: newActionId(),
      type: "invoice.create",
      requestedBy: "sandbox-test",
      customerId: "chen-SBTEST",
      args: { items: [{ name: "Kesar Chai Blend", quantity: "3" }], payment_term: "NET_15" },
      target: {},
      requested: {},
    });
    expect(r.status).toBe("allowed");
    const inv = await getInvoice(pp, r.paypalId!);
    const f = invoiceFactsOf(inv);
    expect(f).toMatchObject({ totalUsd: 54, termType: "NET_15", discountPct: 0, status: "DRAFT" });
    expect(f.memo).toMatch(/^ALIGN TEST-4 · alp_/);
    await deleteInvoice(pp, r.paypalId!);
  });

  it("lists disputes", async () => {
    expect(Array.isArray(await listDisputes(pp))).toBe(true);
  });

  it("searches transactions (or says the permission is not active)", async () => {
    try {
      const rows = await searchTransactions(pp, new Date(Date.now() - 2 * 86_400_000), new Date());
      expect(Array.isArray(rows)).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(PayPalError);
      expect((e as PayPalError).notAuthorized).toBe(true);
    }
  });

  it("rejects a webhook with a forged signature", async () => {
    const hooks = await listWebhooks(pp);
    const id = hooks[0]?.id ?? "0000000000000000A";
    const ok = await verifyWebhookSignature(
      pp,
      {
        authAlgo: "SHA256withRSA",
        certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
        transmissionId: "00000000-0000-0000-0000-000000000000",
        transmissionSig: "Zm9yZ2Vk",
        transmissionTime: new Date().toISOString(),
      },
      id,
      '{"id":"WH-FORGED","event_type":"PAYMENT.CAPTURE.REFUNDED","resource":{}}',
    ).catch(() => false);
    expect(ok).toBe(false);
  });
});
