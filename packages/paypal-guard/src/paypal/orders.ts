import { z } from "zod";
import type { PayPalClient } from "./client";

export const Money = z.object({ currency_code: z.string(), value: z.string() });
export type Money = z.infer<typeof Money>;

export const Capture = z.object({
  id: z.string(),
  status: z.string(),
  amount: Money,
  create_time: z.string().optional(),
  custom_id: z.string().optional(),
});
export type Capture = z.infer<typeof Capture>;

export const Refund = z.object({
  id: z.string(),
  status: z.string(),
  amount: Money.optional(),
  create_time: z.string().optional(),
  custom_id: z.string().optional(),
  note_to_payer: z.string().optional(),
});
export type Refund = z.infer<typeof Refund>;

export const PurchaseUnit = z.object({
  reference_id: z.string().optional(),
  custom_id: z.string().optional(),
  description: z.string().optional(),
  amount: Money.optional(),
  payments: z
    .object({ captures: z.array(Capture).optional(), refunds: z.array(Refund).optional() })
    .optional(),
});

export const Order = z.object({
  id: z.string(),
  status: z.string(),
  create_time: z.string().optional(),
  purchase_units: z.array(PurchaseUnit).default([]),
  links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
});
export type Order = z.infer<typeof Order>;

/**
 * One of PayPal's published sandbox test cards (developer.paypal.com → Card testing). Sandbox only: it moves no money.
 */
export const SANDBOX_TEST_CARD = {
  number: "4012888888881881",
  expiry: "2030-12",
  security_code: "123",
  name: "Fictional Customer",
  billing_address: {
    address_line_1: "1 Test Street",
    admin_area_2: "San Jose",
    admin_area_1: "CA",
    postal_code: "95131",
    country_code: "US",
  },
} as const;

export interface OrderItem {
  name: string;
  quantity: number;
  unitUsd: number;
  sku?: string;
}

function orderBody(customId: string, description: string, items: OrderItem[]) {
  const total = items.reduce((s, i) => s + i.quantity * i.unitUsd, 0);
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: customId,
        description,
        amount: {
          currency_code: "USD",
          value: total.toFixed(2),
          breakdown: { item_total: { currency_code: "USD", value: total.toFixed(2) } },
        },
        items: items.map((i) => ({
          name: i.name,
          quantity: String(i.quantity),
          unit_amount: { currency_code: "USD", value: i.unitUsd.toFixed(2) },
          ...(i.sku ? { sku: i.sku } : {}),
        })),
      },
    ],
  };
}

/**
 * The card path: create an order with intent CAPTURE and a sandbox test card. PayPal answers COMPLETED with the
 * capture inside, so no separate capture call is made.
 */
export async function createCardOrder(
  pp: PayPalClient,
  a: { customId: string; description: string; items: OrderItem[]; requestId: string },
): Promise<Order> {
  return pp.request("POST", "/v2/checkout/orders", {
    requestId: a.requestId,
    prefer: "return=representation",
    body: { ...orderBody(a.customId, a.description, a.items), payment_source: { card: SANDBOX_TEST_CARD } },
    schema: Order,
  });
}

/** An order for the PayPal buttons on the store page; the buyer approves it, then the server captures it. */
export async function createButtonOrder(
  pp: PayPalClient,
  a: { customId: string; description: string; items: OrderItem[]; requestId: string },
): Promise<Order> {
  return pp.request("POST", "/v2/checkout/orders", {
    requestId: a.requestId,
    prefer: "return=representation",
    body: orderBody(a.customId, a.description, a.items),
    schema: Order,
  });
}

export async function captureOrder(pp: PayPalClient, orderId: string, requestId: string): Promise<Order> {
  return pp.request("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    requestId,
    prefer: "return=representation",
    body: {},
    schema: Order,
  });
}

export async function getOrder(pp: PayPalClient, orderId: string): Promise<Order> {
  return pp.request("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { schema: Order });
}

export const CaptureDetail = Capture.extend({
  supplementary_data: z
    .object({ related_ids: z.object({ order_id: z.string().optional() }).optional() })
    .optional(),
});

export async function getCapture(pp: PayPalClient, captureId: string) {
  return pp.request("GET", `/v2/payments/captures/${encodeURIComponent(captureId)}`, { schema: CaptureDetail });
}

/** Captures, refunds and remaining refundable amount of an order's first purchase unit. */
export function orderMoney(order: Order) {
  const pu = order.purchase_units[0];
  const captures = pu?.payments?.captures ?? [];
  const refunds = pu?.payments?.refunds ?? [];
  const currencies = new Set([...captures.map((c) => c.amount.currency_code), ...refunds.flatMap((r) => (r.amount ? [r.amount.currency_code] : []))]);
  const captured = captures
    .filter((c) => ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(c.status))
    .reduce((s, c) => s + Number(c.amount.value), 0);
  const refunded = refunds
    .filter((r) => ["COMPLETED", "PENDING"].includes(r.status))
    .reduce((s, r) => s + Number(r.amount?.value ?? 0), 0);
  return {
    customId: pu?.custom_id ?? null,
    capture: captures[0] ?? null,
    captures,
    refunds,
    currency: currencies.size === 1 ? [...currencies][0]! : currencies.size === 0 ? null : "MIXED",
    capturedUsd: Math.round(captured * 100) / 100,
    refundedUsd: Math.round(refunded * 100) / 100,
    remainingUsd: Math.round((captured - refunded) * 100) / 100,
  };
}
