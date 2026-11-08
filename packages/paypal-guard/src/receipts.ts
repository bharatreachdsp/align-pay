import { usd } from "./actions";
import type { FactValue, Outcome } from "./engine";
import { resultOf } from "./guard";
import type { Policy, Receipt } from "./policy";
import type { ActionRecord } from "./store/types";

export interface ReceiptCard {
  actionId: string;
  status: "allowed" | "held" | "blocked" | "denied" | "failed";
  type: ActionRecord["type"];
  title: string;
  decisionKey: string | null;
  /** What the outcome rests on: a decision, PayPal's records alone, or nobody's decision. */
  basis: "decision" | "paypal" | "no_decision";
  statement: string | null;
  receipts: Receipt[];
  reason: string;
  explanation: string | null;
  alternative: string | null;
  facts: { label: string; value: string }[];
  checks: { key: string | null; check: string; outcome: Outcome; reason: string }[];
  paypalId: string | null;
  paypalLabel: string;
  amountUsd: number | null;
  customerId: string | null;
  approver: string | null;
  approverNote: string | null;
  decidedAt: string | null;
  webhookVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const LABELS: Record<string, string> = {
  captured: "Captured (PayPal)",
  refunded: "Refunded so far (PayPal)",
  refundedBefore: "Refunded before (PayPal)",
  remaining: "Left to refund (PayPal)",
  requested: "Asked for",
  orderTotalRefunded: "Order refunds after this",
  max: "Limit",
  refundsInWindow: "Customer's refunds in window",
  windowDays: "Window (days)",
  openDisputes: "Open disputes (PayPal)",
  invoiceTotal: "Invoice total",
  terms: "Terms",
  allowedTerms: "Allowed terms",
  discountPct: "Discount %",
  maxDiscountPct: "Max discount %",
  customer: "Customer (PayPal custom_id)",
  order: "Order",
  capture: "Capture",
  currency: "Currency",
  missing: "Could not read",
  invoice: "Invoice",
  refundsInLast30Days: "Customer's refunds, last 30 days",
};

const MONEY = new Set(["captured", "refunded", "refundedBefore", "remaining", "requested", "orderTotalRefunded", "invoiceTotal"]);

function fmt(k: string, v: FactValue, check: string): string {
  if (v === null) return "unknown";
  if (typeof v === "number" && (MONEY.has(k) || (k === "max" && check === "auto_max_amount"))) return usd(v);
  if (typeof v === "string" && /^NET_\d+$/.test(v)) return v.replace("NET_", "net ");
  return String(v);
}

const TITLES: Record<string, string> = {
  "refund.create": "Refund",
  "invoice.create": "Create invoice",
  "invoice.send": "Send invoice",
  "invoice.cancel": "Cancel invoice",
  unknown: "Unknown tool",
};

/** Everything a receipt card shows, from the stored action and the policies it was evaluated against. */
export function receiptCard(rec: ActionRecord, policies: Policy[]): ReceiptCard {
  const r = resultOf(rec);
  const v = rec.verdict;
  const key = rec.decisionKey;
  const policy = key ? policies.find((p) => p.decisionKey === key) : undefined;
  const firing = v.results.find((x) => x.decisionKey === key) ?? v.results.find((x) => x.outcome !== "allow");
  const facts = new Map<string, string>();
  for (const [k, val] of Object.entries(v.factsUsed ?? {})) {
    if (val === null || val === undefined) continue;
    facts.set(LABELS[k] ?? k, fmt(k, val, ""));
  }
  const order = [...v.results.filter((x) => x.decisionKey === key), ...v.results];
  for (const res of order) {
    for (const [k, val] of Object.entries(res.facts)) {
      const label = LABELS[k] ?? k;
      if (!facts.has(label)) facts.set(label, fmt(k, val, res.check));
    }
  }
  return {
    actionId: rec.id,
    status: r.status,
    type: rec.type,
    title: `${TITLES[rec.type] ?? rec.type}${rec.amountUsd !== undefined ? ` · ${usd(rec.amountUsd)}` : v.requestedUsd !== null ? ` · ${usd(v.requestedUsd)}` : ""}`,
    decisionKey: key,
    basis: key ? "decision" : v.code === "no_decision" || v.code === "unknown_tool" ? "no_decision" : "paypal",
    statement: policy?.statement ?? firing?.statement ?? null,
    receipts: policy?.receipts ?? (firing?.quotes ?? []).map((q) => ({ quote: q, source: "ledger" })),
    reason: rec.status === "denied" ? r.reason : v.reason,
    explanation: rec.explanation ?? null,
    alternative: rec.alternative ?? null,
    facts: [...facts.entries()].map(([label, value]) => ({ label, value })).slice(0, 10),
    checks: v.results.map((x) => ({ key: x.decisionKey, check: x.check, outcome: x.outcome, reason: x.reason })),
    paypalId: rec.paypalId ?? null,
    paypalLabel: rec.type === "refund.create" ? "PayPal refund" : "PayPal invoice",
    amountUsd: rec.amountUsd ?? v.requestedUsd ?? null,
    customerId: rec.paypalCustomerId ?? rec.customerId ?? null,
    approver: rec.approver ?? null,
    approverNote: rec.approverNote ?? null,
    decidedAt: rec.decidedAt ?? null,
    webhookVerifiedAt: rec.webhookVerifiedAt ?? null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
