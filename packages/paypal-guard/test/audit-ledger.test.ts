import { describe, expect, it } from "vitest";
import { classifyAudit } from "../src/audit";
import { decisionFromGet, keysFromSearch } from "../src/ledger/align-mcp";
import { syncLedger } from "../src/ledger/cache";
import type { Ledger, LedgerSnapshot } from "../src/ledger/types";
import { STORE_RULE_STATEMENTS } from "../src/ledger/types";
import { silentLogger } from "../src/paypal/client";
import type { TransactionInfo } from "../src/paypal/transactions";
import { memoryStore } from "../src/store/memory";
import type { ActionRecord } from "../src/store/types";
import { NOW } from "./helpers";

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const tx = (o: Partial<TransactionInfo> & { transaction_id: string; transaction_event_code: string }): TransactionInfo => ({
  transaction_initiation_date: hoursAgo(5),
  transaction_amount: { currency_code: "USD", value: "-20.00" },
  ...o,
});
const executedRefund = (o: Partial<ActionRecord>): ActionRecord =>
  ({
    id: "alp_01JTEST0000000000000000001",
    type: "refund.create",
    status: "executed",
    decisionKey: "AL-11",
    paypalId: "REF-GUARD",
    executedAt: hoursAgo(4),
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(4),
    orderId: "ORD-BEN",
    amountUsd: 20,
    ...o,
  }) as ActionRecord;

describe("audit", () => {
  it("traces guard refunds, flags the outside refund untraced, and matches incoming payments", () => {
    const r = classifyAudit({
      now: NOW,
      transactions: [
        tx({ transaction_id: "REF-GUARD", transaction_event_code: "T1107", paypal_reference_id: "CAP-BEN" }),
        tx({ transaction_id: "REF-OUTSIDE", transaction_event_code: "T1107", paypal_reference_id: "CAP-DANA" }),
        tx({ transaction_id: "CAP-BEN", transaction_event_code: "T0006", transaction_amount: { currency_code: "USD", value: "25.00" }, custom_field: "ben-T3ST" }),
      ],
      invoices: [],
      actions: [executedRefund({})],
      orders: [{ orderId: "ORD-BEN", captureId: "CAP-BEN", customerId: "ben-T3ST", items: [], totalUsd: 25, createdAt: hoursAgo(5), source: "scenario" }],
      webhookEvents: [],
    });
    const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(by["REF-GUARD"]!.cls).toBe("traced");
    expect(by["REF-GUARD"]!.label).toBe("traced to AL-11 via action alp_01JTEST0000000000000000001");
    expect(by["REF-OUTSIDE"]!.cls).toBe("untraced");
    expect(by["CAP-BEN"]!.label).toBe("incoming payment (order ORD-BEN)");
  });

  it("a fresh guard refund confirmed by webhook waits for PayPal's listing", () => {
    const r = classifyAudit({
      now: NOW,
      transactions: [],
      invoices: [],
      actions: [executedRefund({ paypalId: "REF-NEW", executedAt: hoursAgo(0.1), webhookVerifiedAt: hoursAgo(0.09) })],
      orders: [],
      webhookEvents: [],
    });
    expect(r.rows[0]!.cls).toBe("webhook_verified");
    expect(r.rows[0]!.label).toBe("traced to AL-11 via action alp_01JTEST0000000000000000001");
    expect(r.rows[0]!.note).toBe("webhook verified, awaiting PayPal's listing");
  });

  it("a webhook refund with no action behind it is untraced before PayPal lists it", () => {
    const r = classifyAudit({
      now: NOW,
      transactions: null,
      transactionsError: "403",
      invoices: [],
      actions: [],
      orders: [],
      webhookEvents: [{ id: "WH-1", eventType: "PAYMENT.CAPTURE.REFUNDED", resourceId: "REF-X", receivedAt: hoursAgo(0.2), createTime: hoursAgo(0.2), summary: null, matched: null }],
    });
    expect(r.rows[0]!.cls).toBe("untraced");
    expect(r.transactionSearch).toBe("unavailable");
  });

  it("a refund carrying another copy's action id is labelled as such, not untraced", () => {
    const r = classifyAudit({
      now: NOW,
      transactions: [tx({ transaction_id: "REF-COPY", transaction_event_code: "T1107", custom_field: "alp_01JTEST0000000000000000009" })],
      invoices: [],
      actions: [],
      orders: [],
      webhookEvents: [{ id: "WH-9", eventType: "PAYMENT.CAPTURE.REFUNDED", resourceId: "REF-HOOK", receivedAt: hoursAgo(0.1), createTime: hoursAgo(0.1), summary: null, matched: null, customId: "alp_01JTEST0000000000000000008" }],
    });
    expect(r.rows.find((x) => x.id === "REF-COPY")!.cls).toBe("other");
    expect(r.rows.find((x) => x.id === "REF-HOOK")!.label).toMatch(/another copy of ALIGN Pay/);
  });

  it("invoices trace through the action that created and sent them", () => {
    const create = executedRefund({ id: "alp_01JTEST0000000000000000002", type: "invoice.create", paypalId: "INV2-A", invoiceId: "INV2-A", decisionKey: "AL-14" });
    const send = executedRefund({ id: "alp_01JTEST0000000000000000003", type: "invoice.send", paypalId: "INV2-A", invoiceId: "INV2-A", decisionKey: "AL-14" });
    const r = classifyAudit({
      now: NOW,
      transactions: [],
      invoices: [
        { id: "INV2-A", status: "SENT", detail: { memo: "ALIGN AL-14 · alp_01JTEST0000000000000000002" }, amount: { currency_code: "USD", value: "3240.00" } },
        { id: "INV2-B", status: "SENT", detail: {}, amount: { currency_code: "USD", value: "99.00" } },
        { id: "INV2-C", status: "DRAFT", detail: { memo: "ALIGN AL-4 · alp_01JTEST0000000000000000007" }, amount: { currency_code: "USD", value: "3240.00" } },
      ],
      actions: [create, send],
      orders: [],
      webhookEvents: [],
    });
    const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(by["INV2-A"]!.cls).toBe("traced");
    expect(by["INV2-A"]!.label).toMatch(/traced to AL-14 via action alp_01JTEST0000000000000000003/);
    expect(by["INV2-B"]!.cls).toBe("untraced");
    expect(by["INV2-C"]!.cls).toBe("other");
  });
});

describe("ALIGN's MCP answers", () => {
  it("keys come from structured content, else from the text; questions are skipped", () => {
    expect(keysFromSearch({ structuredContent: { items: [{ key: "AL-12", statement: "x" }, { key: "Q-3" }] } })).toEqual(["AL-12"]);
    expect(keysFromSearch({ content: [{ type: "text", text: "- AL-7 refund rule\n- Q-2 open" }] })).toEqual(["AL-7"]);
  });

  it("a decision with its receipts and revision", () => {
    const d = decisionFromGet(
      "AL-12",
      {
        structuredContent: {
          key: "AL-12",
          statement: STORE_RULE_STATEMENTS[0],
          status: "confirmed",
          revision: 2,
          rationale: "speed",
          confirmed_by: { id: "u1", display_name: "Prateek Sharma" },
          evidence: [{ kind: "confirmation", locator: "cli", quote: STORE_RULE_STATEMENTS[0], url: null, added_in_revision: 1, created_at: "2026-11-08T06:00:00Z" }],
        },
      },
      STORE_RULE_STATEMENTS,
    )!;
    expect(d).toMatchObject({ key: "AL-12", revision: 2, status: "confirmed", confirmedBy: "Prateek Sharma" });
    expect(d.receipts[0]!.source).toBe("ALIGN · confirmation");
  });
});

describe("ledger selection", () => {
  const snap = (mode: "align" | "sample"): LedgerSnapshot => ({
    mode,
    syncedAt: NOW.toISOString(),
    source: mode,
    decisions: [{ key: "AL-1", statement: STORE_RULE_STATEMENTS[0], status: "confirmed", revision: 1, why: null, receipts: [], confirmedBy: null, confirmedAt: null }],
  });
  const ok = (mode: "align" | "sample"): Ledger => ({ mode, sync: async () => snap(mode) });
  const down: Ledger = { mode: "align", sync: async () => Promise.reject(new Error("not signed in")) };
  const empty: Ledger = { mode: "align", sync: async () => ({ ...snap("align"), decisions: [] }) };

  it("uses the Sample ALIGN ledger by default, and never touches a live ALIGN client", async () => {
    let called = false;
    const spy: Ledger = { mode: "align", sync: async () => ((called = true), snap("align")) };
    const r = await syncLedger({ preference: "sample", align: spy, sample: ok("sample"), store: memoryStore(), log: silentLogger });
    expect(r.snapshot!.mode).toBe("sample");
    expect(called).toBe(false);
  });

  it("in ALIGN mode: ALIGN, then its cached copy; never the sample", async () => {
    const store = memoryStore();
    expect((await syncLedger({ preference: "align", align: ok("align"), sample: ok("sample"), store, log: silentLogger })).snapshot!.mode).toBe("align");
    const cached = await syncLedger({ preference: "align", align: down, sample: ok("sample"), store, log: silentLogger });
    expect(cached.snapshot!.mode).toBe("align");
    expect(cached.snapshot!.stale).toBe(true);
  });

  it("in ALIGN mode with no cache there is no ledger, so everything is held", async () => {
    const r = await syncLedger({ preference: "align", align: down, sample: ok("sample"), store: memoryStore(), log: silentLogger });
    expect(r.snapshot).toBeNull();
    expect(r.reason).toMatch(/no cached copy/);
  });

  it("decisions that vanish from ALIGN clear the old copy", async () => {
    const store = memoryStore();
    await syncLedger({ preference: "align", align: ok("align"), sample: ok("sample"), store, log: silentLogger });
    const r = await syncLedger({ preference: "align", align: empty, sample: ok("sample"), store, log: silentLogger });
    expect(r.snapshot).toBeNull();
    expect(store.getLedgerSnapshot()).toBeNull();
  });
});
