import type { PayPalClient } from "./client";
import { Refund } from "./orders";

/** Payments v2: refund a capture. `customId` and `noteToPayer` tie the refund to the action and the decision. */
export async function refundCapture(
  pp: PayPalClient,
  a: { captureId: string; amountUsd: number; requestId: string; customId?: string; noteToPayer?: string },
): Promise<Refund> {
  return pp.request("POST", `/v2/payments/captures/${encodeURIComponent(a.captureId)}/refund`, {
    requestId: a.requestId,
    prefer: "return=representation",
    body: {
      amount: { currency_code: "USD", value: a.amountUsd.toFixed(2) },
      ...(a.customId ? { custom_id: a.customId } : {}),
      ...(a.noteToPayer ? { note_to_payer: a.noteToPayer.slice(0, 255) } : {}),
    },
    schema: Refund,
  });
}

export async function getRefund(pp: PayPalClient, refundId: string): Promise<Refund> {
  return pp.request("GET", `/v2/payments/refunds/${encodeURIComponent(refundId)}`, { schema: Refund });
}
