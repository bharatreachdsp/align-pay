import { z } from "zod";
import type { PayPalClient } from "./client";
import { Money } from "./orders";

const Discount = z
  .object({ percent: z.string().optional(), amount: Money.optional() })
  .optional();

export const Invoice = z.object({
  id: z.string(),
  status: z.string(),
  detail: z
    .object({
      currency_code: z.string().optional(),
      invoice_number: z.string().optional(),
      invoice_date: z.string().optional(),
      memo: z.string().optional(),
      note: z.string().optional(),
      payment_term: z.object({ term_type: z.string().optional(), due_date: z.string().optional() }).optional(),
      metadata: z.object({ create_time: z.string().optional(), last_update_time: z.string().optional() }).optional(),
    })
    .optional(),
  primary_recipients: z
    .array(
      z.object({
        billing_info: z
          .object({ email_address: z.string().optional(), business_name: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
  items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.string(),
        unit_amount: Money,
        discount: Discount,
      }),
    )
    .optional(),
  amount: z
    .object({
      currency_code: z.string(),
      value: z.string(),
      breakdown: z
        .object({
          item_total: Money.optional(),
          discount: z
            .object({ invoice_discount: Discount, item_discount: Money.optional() })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
export type Invoice = z.infer<typeof Invoice>;

export interface InvoiceDraft {
  customerId: string;
  recipient: { email: string; businessName: string; givenName: string; surname: string };
  items: { sku: string; name: string; quantity: number; unitUsd: number }[];
  discountPct: number;
  termType: string;
  note?: string;
  subtotalUsd: number;
  discountUsd: number;
  totalUsd: number;
}

/** Invoicing v2 create payload from a normalised draft. `memo` is the merchant-only note that carries the decision. */
export function invoicePayload(d: InvoiceDraft, memo: string, today: string) {
  return {
    detail: {
      currency_code: "USD",
      invoice_date: today,
      payment_term: { term_type: d.termType },
      memo,
      ...(d.note ? { note: d.note.slice(0, 4000) } : {}),
    },
    invoicer: { business_name: "Kettle & Kesar (fictional store)" },
    primary_recipients: [
      {
        billing_info: {
          business_name: d.recipient.businessName,
          name: { given_name: d.recipient.givenName, surname: d.recipient.surname },
          email_address: d.recipient.email,
        },
      },
    ],
    items: d.items.map((i) => ({
      name: i.name,
      quantity: String(i.quantity),
      unit_amount: { currency_code: "USD", value: i.unitUsd.toFixed(2) },
      unit_of_measure: "QUANTITY",
      ...(d.discountPct > 0 ? { discount: { percent: String(d.discountPct) } } : {}),
    })),
  };
}

export async function createInvoice(pp: PayPalClient, payload: unknown, requestId: string): Promise<Invoice> {
  return pp.request("POST", "/v2/invoicing/invoices", {
    requestId,
    prefer: "return=representation",
    body: payload,
    schema: Invoice,
  });
}

export async function getInvoice(pp: PayPalClient, id: string): Promise<Invoice> {
  return pp.request("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`, { schema: Invoice });
}

export async function sendInvoice(pp: PayPalClient, id: string, requestId: string): Promise<void> {
  await pp.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
    requestId,
    body: { send_to_invoicer: false, send_to_recipient: true },
    allowEmpty: true,
  });
}

export async function cancelInvoice(pp: PayPalClient, id: string, requestId: string): Promise<void> {
  await pp.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    requestId,
    body: { send_to_invoicer: false, send_to_recipient: false },
    allowEmpty: true,
  });
}

export const InvoiceList = z.object({
  items: z.array(Invoice).default([]),
  total_items: z.number().optional(),
  total_pages: z.number().optional(),
});

export async function listInvoices(pp: PayPalClient, pages = 3): Promise<Invoice[]> {
  const out: Invoice[] = [];
  for (let page = 1; page <= pages; page++) {
    const r = await pp.request("GET", "/v2/invoicing/invoices", {
      query: { page, page_size: 100, total_required: true },
      schema: InvoiceList,
    });
    out.push(...r.items);
    if (!r.total_pages || page >= r.total_pages) break;
  }
  return out;
}

/** Total, payment term and the largest discount percentage on a PayPal invoice. */
export function invoiceFactsOf(inv: Invoice) {
  const itemTotal = (inv.items ?? []).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_amount.value), 0);
  const pcts: number[] = [];
  const invDisc = inv.amount?.breakdown?.discount?.invoice_discount;
  if (invDisc?.percent) pcts.push(Number(invDisc.percent));
  else if (invDisc?.amount && itemTotal > 0) pcts.push((Number(invDisc.amount.value) / itemTotal) * 100);
  for (const i of inv.items ?? []) {
    const line = Number(i.quantity) * Number(i.unit_amount.value);
    if (i.discount?.percent) pcts.push(Number(i.discount.percent));
    else if (i.discount?.amount && line > 0) pcts.push((Number(i.discount.amount.value) / line) * 100);
  }
  const total = inv.amount ? Number(inv.amount.value) : null;
  return {
    status: inv.status,
    currency: inv.amount?.currency_code ?? inv.detail?.currency_code ?? null,
    totalUsd: total === null || Number.isNaN(total) ? null : Math.round(total * 100) / 100,
    termType: inv.detail?.payment_term?.term_type ?? "DUE_ON_RECEIPT",
    discountPct: pcts.length ? Math.round(Math.max(...pcts) * 100) / 100 : 0,
    recipientEmail: inv.primary_recipients?.[0]?.billing_info?.email_address ?? null,
    memo: inv.detail?.memo ?? null,
  };
}
