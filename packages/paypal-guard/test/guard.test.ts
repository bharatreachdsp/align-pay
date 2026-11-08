import { describe, expect, it } from "vitest";
import { receiptCard } from "../src/receipts";
import { ALL, BEN, daysAgo, invoiceAction, invoiceFacts, makeGuard, refundAction, refundFacts } from "./helpers";

describe("guard.handle", () => {
  it("executes an allowed refund through the executor, with the decision key", async () => {
    const { guard, executor, store } = makeGuard(refundFacts({ customerId: BEN }));
    const a = refundAction({ customerId: BEN, requested: { amountUsd: 20 } });
    const r = await guard.handle(a);
    expect(r.status).toBe("allowed");
    expect(r.key).toBe("AL-11");
    expect(r.paypalId).toBe("REFUND1");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]!.rec.id).toBe(a.id);
    const rec = store.getAction(a.id)!;
    expect(rec.status).toBe("executed");
    expect(rec.paypalCustomerId).toBe(BEN);
  });

  it("stores a hold and does not touch PayPal", async () => {
    const { guard, executor, store } = makeGuard(refundFacts());
    const r = await guard.handle(refundAction());
    expect(r.status).toBe("held");
    expect(r.alternative).toMatch(/owner has been asked/);
    expect(executor.calls).toHaveLength(0);
    expect(store.listActions({ status: "held" })).toHaveLength(1);
  });

  it("blocks with the reason and an alternative for D2", async () => {
    const { guard, executor } = makeGuard(refundFacts({ customerId: BEN, customerRefunds: [{ id: "R1", at: daysAgo(0), amountUsd: 20, source: "alignpay" }] }));
    const r = await guard.handle(refundAction({ customerId: BEN, requested: { amountUsd: 40 } }));
    expect(r.status).toBe("blocked");
    expect(r.key).toBe("AL-12");
    expect(r.alternative).toMatch(/email the owner/);
    expect(executor.calls).toHaveLength(0);
  });

  it("is idempotent: the same action id executes once", async () => {
    const { guard, executor } = makeGuard(refundFacts({ customerId: BEN }));
    const a = refundAction({ customerId: BEN, requested: { amountUsd: 20 } });
    const [r1, r2] = await Promise.all([guard.handle(a), guard.handle(a)]);
    const r3 = await guard.handle(a);
    expect(executor.calls).toHaveLength(1);
    expect(r1.paypalId).toBe("REFUND1");
    expect(r2.paypalId).toBe("REFUND1");
    expect(r3.paypalId).toBe("REFUND1");
  });

  it("a PayPal failure is recorded as failed, never as allowed", async () => {
    const { guard, executor, store } = makeGuard(refundFacts({ customerId: BEN }));
    executor.fail = true;
    const a = refundAction({ customerId: BEN, requested: { amountUsd: 20 } });
    const r = await guard.handle(a);
    expect(r.status).toBe("failed");
    expect(store.getAction(a.id)!.status).toBe("failed");
  });

  it("facts that throw are missing facts → held", async () => {
    const { guard, executor } = makeGuard(() => {
      throw new Error("PayPal unreachable");
    });
    const r = await guard.handle(refundAction({ requested: { amountUsd: 5 } }));
    expect(r.status).toBe("held");
    expect(executor.calls).toHaveLength(0);
  });

  it("a missing ledger → held", async () => {
    const { guard, executor } = makeGuard(refundFacts(), [], {
      policies: { current: async () => ({ ledger: { available: false, reason: "no cache" }, policies: [] }) },
    });
    const r = await guard.handle(refundAction({ requested: { amountUsd: 5 } }));
    expect(r.status).toBe("held");
    expect(executor.calls).toHaveLength(0);
  });

  it("an unknown tool is held and can never be executed, even when approved", async () => {
    const { guard, executor } = makeGuard(refundFacts());
    const r = await guard.handleUnknownTool("payout_everyone", { amount: 1000 }, {});
    expect(r.status).toBe("held");
    const again = await guard.approve(r.actionId, { approver: "store owner" });
    expect(again.status).toBe("held");
    expect(executor.calls).toHaveLength(0);
  });

  it("the Flash explanation is used when it answers in time, else the deterministic reason stays", async () => {
    const fast = makeGuard(refundFacts(), ALL, { explain: async () => "Refunds above $50 wait for the owner." });
    const r1 = await fast.guard.handle(refundAction());
    expect(fast.store.getAction(r1.actionId)!.explanation).toBe("Refunds above $50 wait for the owner.");
    const failing = makeGuard(refundFacts(), ALL, { explain: async () => Promise.reject(new Error("model down")) });
    const r2 = await failing.guard.handle(refundAction());
    expect(failing.store.getAction(r2.actionId)!.explanation).toBeUndefined();
    expect(r2.reason).toMatch(/above \$50/);
  });
});

describe("approve and deny", () => {
  it("approve re-reads the facts, then executes once, recording the approver", async () => {
    const { guard, executor, store, facts } = makeGuard(refundFacts());
    const held = await guard.handle(refundAction());
    expect(facts.calls).toBe(1);
    const r = await guard.approve(held.actionId, { approver: "store owner", note: "damaged in transit" });
    expect(facts.calls).toBe(2);
    expect(r.status).toBe("allowed");
    expect(r.key).toBe("AL-11");
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]!.verdict.approved).toBe(true);
    const rec = store.getAction(held.actionId)!;
    expect(rec.approver).toBe("store owner");
    expect(rec.approverNote).toBe("damaged in transit");
    // Approving again changes nothing.
    await guard.approve(held.actionId, { approver: "store owner" });
    expect(executor.calls).toHaveLength(1);
  });

  it("approval overrides hold rules only: a block found on re-check still blocks", async () => {
    let refunds: { id: string; at: string; amountUsd: number; source: "alignpay" }[] = [];
    const { guard, executor } = makeGuard(() => refundFacts({ customerRefunds: refunds }));
    const held = await guard.handle(refundAction());
    expect(held.status).toBe("held");
    refunds = [{ id: "R9", at: daysAgo(1), amountUsd: 10, source: "alignpay" }];
    const r = await guard.approve(held.actionId, { approver: "store owner" });
    expect(r.status).toBe("blocked");
    expect(r.key).toBe("AL-12");
    expect(executor.calls).toHaveLength(0);
  });

  it("approval with facts gone missing stays held", async () => {
    let ok = true;
    const { guard, executor } = makeGuard(() => (ok ? refundFacts() : refundFacts({ openDisputes: null })));
    const held = await guard.handle(refundAction());
    ok = false;
    const r = await guard.approve(held.actionId, { approver: "store owner" });
    expect(r.status).toBe("held");
    expect(r.reason).toMatch(/Still held/);
    expect(executor.calls).toHaveLength(0);
  });

  it("the invoice send held under D4 is sent after approval, keeping D4's key", async () => {
    const { guard, executor } = makeGuard(invoiceFacts({ source: "paypal", invoiceId: "INV2-TEST-0000-0000-0001" }));
    const held = await guard.handle(invoiceAction("invoice.send"));
    expect(held.status).toBe("held");
    const r = await guard.approve(held.actionId, { approver: "store owner" });
    expect(r.status).toBe("allowed");
    expect(r.key).toBe("AL-14");
    expect(executor.calls).toHaveLength(1);
  });

  it("deny records it and never executes", async () => {
    const { guard, executor, store } = makeGuard(refundFacts());
    const held = await guard.handle(refundAction());
    const r = await guard.deny(held.actionId, { approver: "store owner", note: "photo shows no damage" });
    expect(r.status).toBe("denied");
    expect(r.reason).toMatch(/declined/);
    expect(store.getAction(held.actionId)!.status).toBe("denied");
    const after = await guard.approve(held.actionId, { approver: "store owner" });
    expect(after.status).toBe("denied");
    expect(executor.calls).toHaveLength(0);
  });
});

describe("receipt cards", () => {
  it("show the decision key, the quote, the PayPal facts and the PayPal id", async () => {
    const { guard, store } = makeGuard(refundFacts());
    const held = await guard.handle(refundAction());
    const card = receiptCard(store.getAction(held.actionId)!, ALL);
    expect(card.status).toBe("held");
    expect(card.decisionKey).toBe("AL-11");
    expect(card.receipts[0]!.quote).toMatch(/\$50 per order/);
    expect(card.facts.find((f) => f.label === "Captured (PayPal)")?.value).toBe("$180");
    await guard.approve(held.actionId, { approver: "store owner" });
    const done = receiptCard(store.getAction(held.actionId)!, ALL);
    expect(done.status).toBe("allowed");
    expect(done.paypalId).toBe("REFUND1");
    expect(done.approver).toBe("store owner");
  });
});
