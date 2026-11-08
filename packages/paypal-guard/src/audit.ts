import type { Invoice } from "./paypal/invoices";
import { type TransactionInfo, LISTING_LAG_MS, isPaymentCode, isRefundCode } from "./paypal/transactions";
import type { ActionRecord, StoreOrder, WebhookEventRecord } from "./store/types";

export type AuditClass = "traced" | "incoming" | "webhook_verified" | "awaiting" | "untraced" | "other";

export interface AuditRow {
  id: string;
  at: string;
  kind: "refund" | "payment" | "invoice" | "other";
  amountUsd: number | null;
  cls: AuditClass;
  label: string;
  decisionKey: string | null;
  actionId: string | null;
  orderId: string | null;
  source: "Transaction Search" | "webhook" | "ALIGN Pay" | "Invoicing";
  note: string | null;
}

export interface AuditInput {
  transactions: TransactionInfo[] | null;
  transactionsError?: string | null;
  invoices: Invoice[] | null;
  actions: ActionRecord[];
  orders: StoreOrder[];
  webhookEvents: WebhookEventRecord[];
  now: Date;
}

export interface AuditReport {
  ranAt: string;
  rows: AuditRow[];
  counts: Record<AuditClass, number>;
  transactionSearch: "active" | "unavailable";
  transactionSearchNote: string | null;
}

const traced = (a: ActionRecord) =>
  a.decisionKey ? `traced to ${a.decisionKey} via action ${a.id}` : `traced to the owner's approval via action ${a.id} (no standing decision)`;
const UNTRACED = "untraced: no ALIGN Pay action or decision behind it";

/**
 * Classifies every money movement: refunds and invoices must trace to a decision (through the action that executed
 * them), incoming payments are matched to store orders, and anything without a decision is flagged untraced.
 */
export function classifyAudit(i: AuditInput): AuditReport {
  const rows: AuditRow[] = [];
  const executed = i.actions.filter((a) => a.status === "executed" && a.paypalId);
  const byPaypalId = new Map(executed.map((a) => [a.paypalId!, a]));
  const byActionId = new Map(executed.map((a) => [a.id, a]));
  const ordersByCapture = new Map(i.orders.filter((o) => o.captureId).map((o) => [o.captureId!, o]));
  const listed = new Set<string>();
  // Payments the store did not take: ALIGN Pay's own sandbox tests and setup checks tag their orders "kk-…".
  const testCaptures = new Set(
    (i.transactions ?? []).filter((t) => isPaymentCode(t.transaction_event_code) && t.custom_field?.startsWith("kk-")).map((t) => t.transaction_id),
  );

  for (const t of i.transactions ?? []) {
    listed.add(t.transaction_id);
    const amount = Number(t.transaction_amount.value);
    const base = {
      id: t.transaction_id,
      at: t.transaction_initiation_date,
      amountUsd: Number.isFinite(amount) ? amount : null,
      source: "Transaction Search" as const,
      note: null,
    };
    if (t.custom_field?.startsWith("kk-") || (t.paypal_reference_id && testCaptures.has(t.paypal_reference_id))) {
      rows.push({
        ...base,
        kind: isRefundCode(t.transaction_event_code) ? "refund" : "payment",
        cls: "other",
        label: `${isRefundCode(t.transaction_event_code) ? "refund" : "payment"} by ALIGN Pay's own sandbox tests or setup check, not the store`,
        decisionKey: null,
        actionId: null,
        orderId: null,
      });
      continue;
    }
    if (isRefundCode(t.transaction_event_code)) {
      const a = byPaypalId.get(t.transaction_id) ?? (t.custom_field ? byActionId.get(t.custom_field) : undefined);
      rows.push({
        ...base,
        kind: "refund",
        cls: a ? "traced" : "untraced",
        label: a ? traced(a) : UNTRACED,
        decisionKey: a?.decisionKey ?? null,
        actionId: a?.id ?? null,
        orderId: a?.orderId ?? null,
        note: a ? null : "For example a refund made directly in PayPal, outside ALIGN Pay.",
      });
    } else if (isPaymentCode(t.transaction_event_code)) {
      const o = ordersByCapture.get(t.transaction_id);
      rows.push({
        ...base,
        kind: "payment",
        cls: "incoming",
        label: o ? `incoming payment (order ${o.orderId})` : t.invoice_id ? `incoming payment (invoice ${t.invoice_id})` : "incoming payment (not a store order)",
        decisionKey: null,
        actionId: null,
        orderId: o?.orderId ?? null,
      });
    } else {
      rows.push({
        ...base,
        kind: "other",
        cls: "other",
        label: `other PayPal transaction (${t.transaction_event_code})`,
        decisionKey: null,
        actionId: null,
        orderId: null,
      });
    }
  }

  // Guard-executed refunds PayPal has not listed yet.
  for (const a of executed.filter((x) => x.type === "refund.create" && !listed.has(x.paypalId!))) {
    const at = a.executedAt ?? a.updatedAt;
    const overdue = i.transactions !== null && i.now.getTime() - Date.parse(at) > LISTING_LAG_MS;
    rows.push({
      id: a.paypalId!,
      at,
      kind: "refund",
      amountUsd: a.amountUsd !== undefined ? -a.amountUsd : null,
      cls: a.webhookVerifiedAt ? "webhook_verified" : "awaiting",
      label: a.webhookVerifiedAt ? "webhook verified, awaiting PayPal's listing" : "recorded by ALIGN Pay, awaiting PayPal's listing",
      decisionKey: a.decisionKey,
      actionId: a.id,
      orderId: a.orderId ?? null,
      source: a.webhookVerifiedAt ? "webhook" : "ALIGN Pay",
      note: `${traced(a)}${overdue ? " · older than three hours and still not listed" : ""}`,
    });
  }

  // Refunds PayPal told us about by webhook that no action explains: untraced, even before Transaction Search lists them.
  for (const e of i.webhookEvents.filter((x) => x.eventType === "PAYMENT.CAPTURE.REFUNDED" && x.resourceId)) {
    if (listed.has(e.resourceId!) || byPaypalId.has(e.resourceId!)) continue;
    listed.add(e.resourceId!);
    rows.push({
      id: e.resourceId!,
      at: e.createTime ?? e.receivedAt,
      kind: "refund",
      amountUsd: null,
      cls: "untraced",
      label: `${UNTRACED} (webhook verified)`,
      decisionKey: null,
      actionId: null,
      orderId: null,
      source: "webhook",
      note: "For example a refund made directly in PayPal, outside ALIGN Pay.",
    });
  }

  // Store orders PayPal has not listed yet.
  for (const o of i.orders.filter((x) => x.captureId && !listed.has(x.captureId))) {
    rows.push({
      id: o.captureId!,
      at: o.createdAt,
      kind: "payment",
      amountUsd: o.totalUsd,
      cls: "incoming",
      label: `incoming payment (order ${o.orderId})`,
      decisionKey: null,
      actionId: null,
      orderId: o.orderId,
      source: o.webhookVerifiedAt ? "webhook" : "ALIGN Pay",
      note: o.webhookVerifiedAt ? "webhook verified, awaiting PayPal's listing" : "awaiting PayPal's listing",
    });
  }

  // Invoices, from the Invoicing API (they are listed at once).
  const invoiceActions = new Map<string, ActionRecord[]>();
  for (const a of executed.filter((x) => x.type.startsWith("invoice."))) {
    const id = a.invoiceId ?? a.paypalId!;
    invoiceActions.set(id, [...(invoiceActions.get(id) ?? []), a]);
  }
  for (const inv of i.invoices ?? []) {
    const acts = invoiceActions.get(inv.id) ?? [];
    const memoAction = /alp_[0-9A-Z]{26}/.exec(inv.detail?.memo ?? "")?.[0];
    const created = acts.find((a) => a.type === "invoice.create") ?? (memoAction ? byActionId.get(memoAction) : undefined);
    const sent = acts.find((a) => a.type === "invoice.send");
    const status = inv.status;
    const ok = created && (status === "DRAFT" || status === "CANCELLED" || sent || !["SENT", "UNPAID", "PAID", "PARTIALLY_PAID"].includes(status));
    rows.push({
      id: inv.id,
      at: inv.detail?.metadata?.create_time ?? inv.detail?.invoice_date ?? i.now.toISOString(),
      kind: "invoice",
      amountUsd: inv.amount ? Number(inv.amount.value) : null,
      cls: ok ? "traced" : "untraced",
      label: ok
        ? sent
          ? `traced to ${sent.decisionKey ?? created!.decisionKey} via action ${sent.id} (sent; created by ${created!.id})`
          : traced(created!)
        : created
          ? "untraced: sent without an ALIGN Pay action"
          : UNTRACED,
      decisionKey: (sent ?? created)?.decisionKey ?? null,
      actionId: (sent ?? created)?.id ?? null,
      orderId: null,
      source: "Invoicing",
      note: `invoice ${status.toLowerCase().replace(/_/g, " ")}`,
    });
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const counts = { traced: 0, incoming: 0, webhook_verified: 0, awaiting: 0, untraced: 0, other: 0 } as Record<AuditClass, number>;
  for (const r of rows) counts[r.cls]++;
  return {
    ranAt: i.now.toISOString(),
    rows,
    counts,
    transactionSearch: i.transactions === null ? "unavailable" : "active",
    transactionSearchNote: i.transactions === null ? (i.transactionsError ?? "Transaction Search did not answer.") : null,
  };
}
