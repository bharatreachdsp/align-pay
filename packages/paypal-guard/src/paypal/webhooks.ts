import { z } from "zod";
import type { PayPalClient } from "./client";

export const WEBHOOK_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
] as const;

const Webhook = z.object({
  id: z.string(),
  url: z.string(),
  event_types: z.array(z.object({ name: z.string() })).default([]),
});
export type Webhook = z.infer<typeof Webhook>;

export async function listWebhooks(pp: PayPalClient): Promise<Webhook[]> {
  const r = await pp.request("GET", "/v1/notifications/webhooks", {
    schema: z.object({ webhooks: z.array(Webhook).default([]) }),
  });
  return r.webhooks;
}

/** Creates the webhook, or points an existing one at the new URL (a quick tunnel's URL changes every run). */
export async function upsertWebhook(
  pp: PayPalClient,
  url: string,
  knownId: string | null,
  requestId: string,
): Promise<Webhook> {
  const hooks = await listWebhooks(pp);
  const existing = hooks.find((h) => h.id === knownId) ?? hooks.find((h) => h.url.endsWith("/api/paypal/webhook"));
  if (existing) {
    if (existing.url === url) return existing;
    return pp.request("PATCH", `/v1/notifications/webhooks/${encodeURIComponent(existing.id)}`, {
      requestId,
      body: [
        { op: "replace", path: "/url", value: url },
        { op: "replace", path: "/event_types", value: WEBHOOK_EVENTS.map((name) => ({ name })) },
      ],
      schema: Webhook,
    });
  }
  return pp.request("POST", "/v1/notifications/webhooks", {
    requestId,
    body: { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) },
    schema: Webhook,
  });
}

export interface TransmissionHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

/** The five PAYPAL-* transmission headers, or null if any is missing. */
export function transmissionHeaders(get: (name: string) => string | null): TransmissionHeaders | null {
  const h = {
    authAlgo: get("paypal-auth-algo"),
    certUrl: get("paypal-cert-url"),
    transmissionId: get("paypal-transmission-id"),
    transmissionSig: get("paypal-transmission-sig"),
    transmissionTime: get("paypal-transmission-time"),
  };
  return Object.values(h).every((v) => typeof v === "string" && v.length > 0) ? (h as TransmissionHeaders) : null;
}

/**
 * The verification request body, with the raw event string inserted as `webhook_event` byte for byte. Re-serialising
 * the parsed JSON would change the bytes PayPal signed, so it is never done.
 */
export function verificationBody(h: TransmissionHeaders, webhookId: string, rawEvent: string): string {
  const s = JSON.stringify;
  return `{"auth_algo":${s(h.authAlgo)},"cert_url":${s(h.certUrl)},"transmission_id":${s(h.transmissionId)},"transmission_sig":${s(
    h.transmissionSig,
  )},"transmission_time":${s(h.transmissionTime)},"webhook_id":${s(webhookId)},"webhook_event":${rawEvent}}`;
}

/** Webhooks v1: POST /v1/notifications/verify-webhook-signature. True only for SUCCESS. */
export async function verifyWebhookSignature(
  pp: PayPalClient,
  h: TransmissionHeaders,
  webhookId: string,
  rawEvent: string,
): Promise<boolean> {
  try {
    JSON.parse(rawEvent);
  } catch {
    return false;
  }
  const r = await pp.request("POST", "/v1/notifications/verify-webhook-signature", {
    body: verificationBody(h, webhookId, rawEvent),
    schema: z.object({ verification_status: z.string() }),
  });
  return r.verification_status === "SUCCESS";
}

export const WebhookEvent = z.object({
  id: z.string(),
  event_type: z.string(),
  create_time: z.string().optional(),
  summary: z.string().optional(),
  resource_type: z.string().optional(),
  resource: z.record(z.string(), z.unknown()).default({}),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;
