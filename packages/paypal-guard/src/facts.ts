import { type Action, TERM_TYPES, parseUsd, safePayPalId } from "./actions";
import type { StoreDirectory } from "./directory";
import type { Logger } from "./paypal/client";
import { type PayPalClient, silentLogger } from "./paypal/client";
import { disputesForTransaction, isOpenDispute } from "./paypal/disputes";
import { type InvoiceDraft, getInvoice, invoiceFactsOf } from "./paypal/invoices";
import { getCapture, getOrder, orderMoney, type Order } from "./paypal/orders";
import { type TransactionInfo, isPaymentCode, isRefundCode, searchTransactions } from "./paypal/transactions";
import type { Store } from "./store/types";

export interface CustomerRefund {
  id: string;
  at: string;
  amountUsd: number | null;
  source: "alignpay" | "paypal order" | "transaction search";
}

export interface RefundFacts {
  kind: "refund";
  orderId: string | null;
  orderStatus: string | null;
  customerId: string | null;
  captureId: string | null;
  captureStatus: string | null;
  captureTime: string | null;
  currency: string | null;
  capturedUsd: number | null;
  refundedUsd: number | null;
  remainingUsd: number | null;
  openDisputes: number | null;
  disputeIds: string[];
  /** Every refund to this customer known from ALIGN Pay's records and PayPal; null if it could not be read. */
  customerRefunds: CustomerRefund[] | null;
  missing: string[];
  notes: string[];
}

export interface InvoiceFacts {
  kind: "invoice";
  invoiceId: string | null;
  status: string | null;
  currency: string | null;
  totalUsd: number | null;
  termType: string | null;
  discountPct: number | null;
  recipientCustomerId: string | null;
  /** For invoice.create: the normalised payload (catalogue prices, the customer's own address). */
  draft: InvoiceDraft | null;
  source: "paypal" | "request";
  problem: string | null;
  missing: string[];
  notes: string[];
}

export type Facts = RefundFacts | InvoiceFacts;

export interface FactsSource {
  facts(action: Action): Promise<Facts>;
}

export const emptyRefund = (orderId: string | null): RefundFacts => ({
  kind: "refund",
  orderId,
  orderStatus: null,
  customerId: null,
  captureId: null,
  captureStatus: null,
  captureTime: null,
  currency: null,
  capturedUsd: null,
  refundedUsd: null,
  remainingUsd: null,
  openDisputes: null,
  disputeIds: [],
  customerRefunds: null,
  missing: [],
  notes: [],
});

export const missingRefundFacts = (why: string): RefundFacts => ({ ...emptyRefund(null), missing: [why] });

export const missingInvoiceFacts = (why: string): InvoiceFacts => ({
  kind: "invoice",
  invoiceId: null,
  status: null,
  currency: null,
  totalUsd: null,
  termType: null,
  discountPct: null,
  recipientCustomerId: null,
  draft: null,
  source: "paypal",
  problem: null,
  missing: [why],
  notes: [],
});

/** Facts that could not be read at all, of the right kind for the action. */
export const missingFactsFor = (type: string, why: string): Facts =>
  type === "refund.create" ? missingRefundFacts(why) : missingInvoiceFacts(why);

// --- invoice requests ----------------------------------------------------------------------------------------------

function termFrom(v: unknown): string | null {
  if (typeof v !== "string" && !(v && typeof v === "object")) return null;
  const raw = typeof v === "string" ? v : String((v as { term_type?: unknown }).term_type ?? "");
  const s = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((TERM_TYPES as readonly string[]).includes(s)) return s;
  const m = /^NET_?(\d{1,2})$/.exec(s);
  if (m) return `NET_${m[1]}`;
  if (/DUE_ON_RECEIPT|ON_RECEIPT|IMMEDIATE/.test(s)) return "DUE_ON_RECEIPT";
  return raw ? `UNSUPPORTED:${s.slice(0, 20)}` : null;
}

/**
 * The agent's create_invoice arguments, reduced to what the store will actually send: products and prices from the
 * catalogue, the recipient from the customer record, the discount and terms as asked. Anything that cannot be
 * normalised is a problem, and the action is held.
 */
export function normaliseInvoiceRequest(
  args: unknown,
  directory: StoreDirectory,
  customerId: string | undefined,
): { draft: InvoiceDraft | null; problem: string | null; notes: string[] } {
  const notes: string[] = [];
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const customer = customerId ? directory.customer(customerId) : null;
  if (!customer) return { draft: null, problem: "The invoice is not for a known store customer.", notes };
  if (a.currency_code !== undefined && String(a.currency_code).toUpperCase() !== "USD") {
    return { draft: null, problem: "Only USD invoices are handled automatically.", notes };
  }
  const rawItems = Array.isArray(a.items) ? (a.items as Record<string, unknown>[]) : [];
  if (rawItems.length === 0 || rawItems.length > 20) return { draft: null, problem: "The invoice needs between 1 and 20 items.", notes };
  const items: InvoiceDraft["items"] = [];
  const pcts = new Set<number>();
  for (const it of rawItems) {
    const product = directory.findProduct(String(it.name ?? it.sku ?? ""));
    if (!product) return { draft: null, problem: `"${String(it.name ?? "").slice(0, 60)}" is not in the store's catalogue.`, notes };
    const q = Number(String(it.quantity ?? "").trim());
    if (!Number.isInteger(q) || q < 1 || q > 10_000) return { draft: null, problem: "Each item needs a whole quantity between 1 and 10,000.", notes };
    const askedPrice = parseUsd((it.unit_amount as { value?: unknown } | undefined)?.value);
    if (askedPrice !== undefined && Math.abs(askedPrice - product.priceUsd) > 0.004) {
      notes.push(`The agent asked ${askedPrice} for ${product.name}; the catalogue price ${product.priceUsd} is used.`);
    }
    const disc = it.discount as { percent?: unknown; amount?: { value?: unknown } } | undefined;
    let pct = 0;
    if (disc?.percent !== undefined) pct = Number(disc.percent);
    else if (disc?.amount?.value !== undefined) {
      const amt = parseUsd(disc.amount.value);
      pct = amt === undefined ? NaN : (amt / (q * product.priceUsd)) * 100;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { draft: null, problem: "A discount must be between 0% and 100%.", notes };
    pcts.add(Math.round(pct * 100) / 100);
    items.push({ sku: product.sku, name: product.name, quantity: q, unitUsd: product.priceUsd });
  }
  // An invoice-wide discount (our extension) applies to every line.
  if (a.discount_percent !== undefined) {
    const p = Number(a.discount_percent);
    if (!Number.isFinite(p) || p < 0 || p > 100) return { draft: null, problem: "A discount must be between 0% and 100%.", notes };
    pcts.clear();
    pcts.add(Math.round(p * 100) / 100);
  }
  const nonZero = [...pcts].filter((p) => p > 0);
  if (nonZero.length > 1 || (nonZero.length === 1 && pcts.size > 1 && a.discount_percent === undefined)) {
    return { draft: null, problem: "Different discounts per line are not handled automatically.", notes };
  }
  const discountPct = nonZero[0] ?? 0;
  const term = termFrom(a.payment_term ?? a.term_type ?? a.terms) ?? "DUE_ON_RECEIPT";
  if (term.startsWith("UNSUPPORTED:")) return { draft: null, problem: "Those payment terms are not ones PayPal supports.", notes };
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitUsd, 0);
  const discountUsd = Math.round(subtotal * discountPct) / 100;
  const prof = customer.name.split(" ");
  return {
    draft: {
      customerId: customer.id,
      recipient: {
        email: customer.email,
        businessName: customer.businessName ?? customer.name,
        givenName: prof[0] ?? customer.name,
        surname: prof.slice(1).join(" ") || customer.name,
      },
      items,
      discountPct,
      termType: term,
      note: typeof a.note === "string" ? a.note.slice(0, 500) : undefined,
      subtotalUsd: Math.round(subtotal * 100) / 100,
      discountUsd,
      totalUsd: Math.round((subtotal - discountUsd) * 100) / 100,
    },
    problem: null,
    notes,
  };
}

// --- PayPal-backed facts -------------------------------------------------------------------------------------------

export interface PayPalFactsOptions {
  paypal: PayPalClient;
  store: Store;
  directory: StoreDirectory;
  now?: () => Date;
  log?: Logger;
  /** Transaction Search adds refunds made outside ALIGN Pay on orders it does not know. On by default. */
  useTransactionSearch?: boolean;
}

export class PayPalFacts implements FactsSource {
  private tsCache: { at: number; rows: TransactionInfo[] } | null = null;
  private readonly log: Logger;
  constructor(private readonly o: PayPalFactsOptions) {
    this.log = o.log ?? silentLogger;
  }

  private now(): Date {
    return this.o.now ? this.o.now() : new Date();
  }

  async facts(action: Action): Promise<Facts> {
    return action.type === "refund.create" ? this.refundFacts(action) : this.invoiceFacts(action);
  }

  /** Transaction Search rows of the last 31 days, cached for two minutes. */
  async recentTransactions(): Promise<TransactionInfo[]> {
    if (this.tsCache && Date.now() - this.tsCache.at < 120_000) return this.tsCache.rows;
    const to = this.now();
    const rows = await searchTransactions(this.o.paypal, new Date(to.getTime() - 31 * 86_400_000), to);
    this.tsCache = { at: Date.now(), rows };
    return rows;
  }

  async refundFacts(action: Action): Promise<RefundFacts> {
    let orderId = safePayPalId(action.target.orderId) ?? null;
    const f = emptyRefund(orderId);
    if (!orderId && action.target.captureId) {
      const captureId = safePayPalId(action.target.captureId);
      if (captureId) {
        try {
          const cap = await getCapture(this.o.paypal, captureId);
          orderId = cap.supplementary_data?.related_ids?.order_id ?? null;
          f.orderId = orderId;
        } catch (e) {
          this.log.warn("capture lookup failed", { error: (e as Error).message });
        }
      }
    }
    if (!orderId) {
      f.missing.push("order");
      return f;
    }
    let order: Order;
    try {
      order = await getOrder(this.o.paypal, orderId);
    } catch (e) {
      this.log.warn("order lookup failed", { error: (e as Error).message });
      f.missing.push("order");
      return f;
    }
    const m = orderMoney(order);
    f.orderStatus = order.status;
    f.customerId = m.customId;
    f.captureId = m.capture?.id ?? null;
    f.captureStatus = m.capture?.status ?? null;
    f.captureTime = m.capture?.create_time ?? null;
    f.currency = m.currency;
    if (m.capture) {
      f.capturedUsd = m.capturedUsd;
      f.refundedUsd = m.refundedUsd;
      f.remainingUsd = m.remainingUsd;
    } else {
      f.missing.push("capture");
    }

    if (f.captureId) {
      try {
        const ds = await disputesForTransaction(this.o.paypal, f.captureId);
        const open = ds.filter(isOpenDispute);
        f.openDisputes = open.length;
        f.disputeIds = open.map((d) => d.dispute_id);
      } catch (e) {
        this.log.warn("dispute lookup failed", { error: (e as Error).message });
        f.missing.push("disputes");
      }
    }

    if (f.customerId) {
      f.customerRefunds = await this.customerRefunds(f.customerId, order, f);
    } else {
      f.missing.push("customer");
    }
    return f;
  }

  /**
   * The customer's refunds: refunds ALIGN Pay executed, refunds PayPal shows on the customer's orders, and (when
   * Transaction Search is active) refunds on any capture carrying the customer's id. Null if PayPal could not be read.
   */
  private async customerRefunds(customerId: string, current: Order, f: RefundFacts): Promise<CustomerRefund[] | null> {
    const seen = new Map<string, CustomerRefund>();
    const add = (r: CustomerRefund) => {
      if (!seen.has(r.id)) seen.set(r.id, r);
    };
    for (const a of this.o.store.listActions({ type: "refund.create", status: "executed" })) {
      if ((a.paypalCustomerId ?? a.customerId) === customerId && a.paypalId) {
        add({ id: a.paypalId, at: a.executedAt ?? a.updatedAt, amountUsd: a.amountUsd ?? null, source: "alignpay" });
      }
    }
    const orderIds = new Set(this.o.store.listOrders({ customerId }).map((o) => o.orderId));
    orderIds.delete(current.id);
    const orders: Order[] = [current];
    for (const id of orderIds) {
      try {
        orders.push(await getOrder(this.o.paypal, id));
      } catch (e) {
        this.log.warn("order lookup failed", { error: (e as Error).message });
        f.missing.push("customer history");
        return null;
      }
    }
    for (const o of orders) {
      if (orderMoney(o).customId !== customerId) continue;
      for (const r of orderMoney(o).refunds) {
        if (!["COMPLETED", "PENDING"].includes(r.status)) continue;
        add({ id: r.id, at: r.create_time ?? new Date(0).toISOString(), amountUsd: Number(r.amount?.value ?? NaN), source: "paypal order" });
      }
    }
    if (this.o.useTransactionSearch !== false) {
      try {
        const rows = await this.recentTransactions();
        const captures = new Set(
          rows.filter((t) => isPaymentCode(t.transaction_event_code) && t.custom_field === customerId).map((t) => t.transaction_id),
        );
        for (const t of rows) {
          if (isRefundCode(t.transaction_event_code) && t.paypal_reference_id && captures.has(t.paypal_reference_id)) {
            add({
              id: t.transaction_id,
              at: t.transaction_initiation_date,
              amountUsd: Math.abs(Number(t.transaction_amount.value)),
              source: "transaction search",
            });
          }
        }
      } catch (e) {
        f.notes.push("Transaction Search was not available; refunds were counted from PayPal's orders and ALIGN Pay's records.");
        this.log.warn("transaction search unavailable for facts", { error: (e as Error).message });
      }
    }
    return [...seen.values()];
  }

  async invoiceFacts(action: Action): Promise<InvoiceFacts> {
    const base: InvoiceFacts = {
      kind: "invoice",
      invoiceId: null,
      status: null,
      currency: null,
      totalUsd: null,
      termType: null,
      discountPct: null,
      recipientCustomerId: null,
      draft: null,
      source: "paypal",
      problem: null,
      missing: [],
      notes: [],
    };
    if (action.type === "invoice.create") {
      const n = normaliseInvoiceRequest(action.args, this.o.directory, action.customerId);
      if (!n.draft) return { ...base, source: "request", problem: n.problem, missing: ["invoice"], notes: n.notes };
      return {
        ...base,
        source: "request",
        currency: "USD",
        totalUsd: n.draft.totalUsd,
        termType: n.draft.termType,
        discountPct: n.draft.discountPct,
        recipientCustomerId: n.draft.customerId,
        draft: n.draft,
        notes: n.notes,
      };
    }
    const invoiceId = safePayPalId(action.target.invoiceId);
    if (!invoiceId) return { ...base, missing: ["invoice"] };
    try {
      const inv = invoiceFactsOf(await getInvoice(this.o.paypal, invoiceId));
      return {
        ...base,
        invoiceId,
        status: inv.status,
        currency: inv.currency,
        totalUsd: inv.totalUsd,
        termType: inv.termType,
        discountPct: inv.discountPct,
        recipientCustomerId: inv.recipientEmail ? (this.o.directory.customerByEmail(inv.recipientEmail)?.id ?? null) : null,
      };
    } catch (e) {
      this.log.warn("invoice lookup failed", { error: (e as Error).message });
      return { ...base, invoiceId, missing: ["invoice"] };
    }
  }
}
