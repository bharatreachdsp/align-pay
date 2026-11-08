import { z } from "zod";
import type { PayPalClient } from "./client";

export const TransactionInfo = z.object({
  transaction_id: z.string(),
  paypal_reference_id: z.string().optional(),
  paypal_reference_id_type: z.string().optional(),
  transaction_event_code: z.string(),
  transaction_initiation_date: z.string(),
  transaction_updated_date: z.string().optional(),
  transaction_amount: z.object({ currency_code: z.string(), value: z.string() }),
  transaction_status: z.string().optional(),
  custom_field: z.string().optional(),
  invoice_id: z.string().optional(),
  transaction_note: z.string().optional(),
  transaction_subject: z.string().optional(),
});
export type TransactionInfo = z.infer<typeof TransactionInfo>;

const SearchPage = z.object({
  transaction_details: z.array(z.object({ transaction_info: TransactionInfo })).default([]),
  total_pages: z.number().optional(),
  page: z.number().optional(),
});

/** Transactions appear in Transaction Search up to three hours after they happen. */
export const LISTING_LAG_MS = 3 * 60 * 60 * 1000;
const WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

const isoNoMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Transaction Search (Reporting v1): every transaction between `from` and `to`, in windows of at most 31 days,
 * paging through each. A 403 means the app's Transaction Search permission is not active yet.
 */
export async function searchTransactions(pp: PayPalClient, from: Date, to: Date): Promise<TransactionInfo[]> {
  const out: TransactionInfo[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += WINDOW_MS) {
    const end = Math.min(start + WINDOW_MS - 1000, to.getTime());
    for (let page = 1; page <= 50; page++) {
      const r = await pp.request("GET", "/v1/reporting/transactions", {
        query: {
          start_date: isoNoMs(new Date(start)),
          end_date: isoNoMs(new Date(end)),
          fields: "all",
          page_size: 500,
          page,
        },
        schema: SearchPage,
      });
      out.push(...r.transaction_details.map((d) => d.transaction_info));
      if (!r.total_pages || page >= r.total_pages) break;
    }
  }
  return out;
}

/** T11xx are reversals; T1107 is a refund the merchant made. */
export const isRefundCode = (code: string): boolean => code === "T1107" || code.startsWith("T11");
/** T00xx are payments received (T0006 is a PayPal checkout payment, T0003 a pre-approved one, …). */
export const isPaymentCode = (code: string): boolean => code.startsWith("T00");
