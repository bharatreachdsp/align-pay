import { z } from "zod";
import type { PayPalClient } from "./client";

export const DisputeSummary = z.object({
  dispute_id: z.string(),
  status: z.string(),
  reason: z.string().optional(),
  create_time: z.string().optional(),
  dispute_amount: z.object({ currency_code: z.string(), value: z.string() }).optional(),
});
export type DisputeSummary = z.infer<typeof DisputeSummary>;

const DisputeList = z.object({ items: z.array(DisputeSummary).default([]) });

/** Disputes v1: every dispute on one capture. Any status other than RESOLVED counts as open. */
export async function disputesForTransaction(pp: PayPalClient, captureId: string): Promise<DisputeSummary[]> {
  const r = await pp.request("GET", "/v1/customer/disputes", {
    query: { disputed_transaction_id: captureId, page_size: 50 },
    schema: DisputeList,
  });
  return r.items;
}

export async function listDisputes(pp: PayPalClient): Promise<DisputeSummary[]> {
  const r = await pp.request("GET", "/v1/customer/disputes", { query: { page_size: 50 }, schema: DisputeList });
  return r.items;
}

export const isOpenDispute = (d: DisputeSummary): boolean => d.status !== "RESOLVED";
