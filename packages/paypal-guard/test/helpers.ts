import { type Action, newActionId } from "../src/actions";
import type { Verdict } from "../src/engine";
import type { ExecResult, Executor } from "../src/execute";
import type { Facts, FactsSource, InvoiceFacts, RefundFacts } from "../src/facts";
import { type GuardDeps, Guard } from "../src/guard";
import { STORE_RULE_STATEMENTS } from "../src/ledger/types";
import type { Limits, Policy } from "../src/policy";
import { memoryStore } from "../src/store/memory";
import type { ActionRecord } from "../src/store/types";
import { kettleAndKesar } from "../src/directory";

export const NOW = new Date("2026-11-08T12:00:00.000Z");
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** The limits the store owner means by the four rules (what a correct draft looks like). */
export const CONFIRMED: Limits[] = [
  { version: 1, governs: ["refund.create"], rules: [{ kind: "auto_max_amount", action: "refund.create", maxUsd: 50, above: "hold" }] },
  { version: 1, governs: ["refund.create"], rules: [{ kind: "per_customer_count", action: "refund.create", max: 1, windowDays: 30, over: "block" }] },
  { version: 1, governs: ["refund.create"], rules: [{ kind: "block_if_open_dispute", action: "refund.create" }] },
  {
    version: 1,
    governs: ["invoice.create", "invoice.send"],
    rules: [
      { kind: "invoice_terms", allowedTerms: ["NET_15"], maxDiscountPct: 10, over: "block" },
      { kind: "auto_max_amount", action: "invoice.send", maxUsd: 2000, above: "hold" },
    ],
  },
];

export function policy(i: number, over: Partial<Policy> = {}): Policy {
  return {
    decisionKey: `AL-${i + 11}`,
    statement: STORE_RULE_STATEMENTS[i]!,
    decisionRevision: 1,
    receipts: [{ quote: STORE_RULE_STATEMENTS[i]!, source: "Sample ALIGN ledger · confirmation" }],
    ledgerMode: "sample",
    status: "confirmed",
    limits: CONFIRMED[i]!,
    reading: null,
    draftedBy: "test",
    draftedAt: NOW.toISOString(),
    confirmedBy: "store owner",
    confirmedAt: NOW.toISOString(),
    confirmMethod: "owner page",
    note: null,
    ...over,
  };
}

export const ALL = [0, 1, 2, 3].map((i) => policy(i));

export const ASHA = "asha-T3ST";
export const BEN = "ben-T3ST";
export const CHEN = "chen-T3ST";

export function refundFacts(o: Partial<RefundFacts> = {}): RefundFacts {
  return {
    kind: "refund",
    orderId: "ORDER0000000000ASHA",
    orderStatus: "COMPLETED",
    customerId: ASHA,
    captureId: "CAPTURE00000000ASHA",
    captureStatus: "COMPLETED",
    captureTime: daysAgo(1),
    currency: "USD",
    capturedUsd: 180,
    refundedUsd: 0,
    remainingUsd: 180,
    openDisputes: 0,
    disputeIds: [],
    customerRefunds: [],
    missing: [],
    notes: [],
    ...o,
  };
}

export function invoiceFacts(o: Partial<InvoiceFacts> = {}): InvoiceFacts {
  return {
    kind: "invoice",
    invoiceId: null,
    status: null,
    currency: "USD",
    totalUsd: 3240,
    termType: "NET_15",
    discountPct: 10,
    recipientCustomerId: CHEN,
    draft: null,
    source: "request",
    problem: null,
    missing: [],
    notes: [],
    ...o,
  };
}

export function refundAction(o: Partial<Action> = {}): Action {
  return {
    id: newActionId(),
    type: "refund.create",
    requestedBy: "support-agent",
    tool: "refund_order",
    args: {},
    target: { orderId: "ORDER0000000000ASHA" },
    requested: { amountUsd: 180 },
    customerId: ASHA,
    ...o,
  };
}

export function invoiceAction(type: Action["type"], o: Partial<Action> = {}): Action {
  return {
    id: newActionId(),
    type,
    requestedBy: "support-agent",
    tool: type === "invoice.create" ? "create_invoice" : "send_invoice",
    args: {},
    target: type === "invoice.create" ? {} : { invoiceId: "INV2-TEST-0000-0000-0001" },
    requested: {},
    customerId: CHEN,
    ...o,
  };
}

export class FakeFacts implements FactsSource {
  calls = 0;
  constructor(public next: Facts | ((a: Action) => Facts)) {}
  async facts(a: Action): Promise<Facts> {
    this.calls++;
    return typeof this.next === "function" ? this.next(a) : this.next;
  }
}

export class FakeExecutor implements Executor {
  calls: { rec: ActionRecord; verdict: Verdict }[] = [];
  fail = false;
  async execute(rec: ActionRecord, _f: Facts, verdict: Verdict): Promise<ExecResult> {
    this.calls.push({ rec, verdict });
    if (this.fail) throw new Error("PayPal answered 422 UNPROCESSABLE_ENTITY");
    return { paypalId: rec.type === "refund.create" ? `REFUND${this.calls.length}` : `INV2-${this.calls.length}`, paypalStatus: "COMPLETED", amountUsd: verdict.requestedUsd ?? 0 };
  }
}

export function makeGuard(facts: Facts | ((a: Action) => Facts), policies: Policy[] = ALL, extra: Partial<GuardDeps> = {}) {
  const store = memoryStore();
  const f = new FakeFacts(facts);
  const executor = new FakeExecutor();
  const guard = new Guard({
    store,
    facts: f,
    executor,
    directory: kettleAndKesar(),
    now: () => NOW,
    policies: { current: async () => ({ ledger: { available: true }, policies }) },
    ...extra,
  });
  return { guard, store, facts: f, executor };
}
