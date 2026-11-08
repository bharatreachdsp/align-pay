import { WebhookEvent, transmissionHeaders, verifyWebhookSignature } from "@align-agent/paypal-guard";
import { runtime } from "./runtime";

export interface WebhookOutcome {
  status: number;
  body: string;
}

/**
 * PayPal webhook: the raw body is verified with PayPal (the five transmission headers, our webhook id, and the raw
 * event string inserted as-is), then reconciled once per event id. Anything unverified is a 400.
 */
export async function handleWebhook(raw: string, header: (name: string) => string | null): Promise<WebhookOutcome> {
  const rt = runtime();
  const h = transmissionHeaders(header);
  const hook = rt.store.getKv<{ id: string }>("webhook");
  if (!h || !hook?.id) return { status: 400, body: "unverified" };
  let ok = false;
  try {
    ok = await verifyWebhookSignature(rt.paypal, h, hook.id, raw);
  } catch (e) {
    rt.log.warn("webhook verification call failed", { error: (e as Error).message.slice(0, 160) });
  }
  if (!ok) return { status: 400, body: "unverified" };

  const parsed = WebhookEvent.safeParse(JSON.parse(raw));
  if (!parsed.success) return { status: 400, body: "bad event" };
  const evt = parsed.data;
  // Reconciled once per event id: PayPal retries deliveries.
  if (rt.store.listWebhookEvents().some((e) => e.id === evt.id)) return { status: 200, body: "duplicate" };
  const res = evt.resource as Record<string, unknown>;
  const invoice = (res.invoice as { id?: string } | undefined)?.id;
  const resourceId = (typeof res.id === "string" ? res.id : null) ?? invoice ?? null;
  const now = new Date().toISOString();
  let matched: string | null = null;

  if (evt.event_type === "PAYMENT.CAPTURE.REFUNDED" || evt.event_type === "PAYMENT.CAPTURE.REVERSED") {
    const customId = typeof res.custom_id === "string" ? res.custom_id : null;
    const a = rt.store.listActions({ type: "refund.create" }).find((x) => x.paypalId === resourceId || (customId && x.id === customId));
    if (a) {
      a.webhookVerifiedAt = now;
      a.webhookEventId = evt.id;
      rt.store.putAction(a);
      matched = a.id;
    }
  } else if (evt.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const o = rt.store.listOrders().find((x) => x.captureId === resourceId);
    if (o) {
      o.webhookVerifiedAt = now;
      rt.store.putOrder(o);
      matched = o.orderId;
    }
  } else if (evt.event_type.startsWith("INVOICING.")) {
    for (const a of rt.store.listActions().filter((x) => x.invoiceId && x.invoiceId === (invoice ?? resourceId))) {
      a.webhookVerifiedAt = now;
      rt.store.putAction(a);
      matched = a.id;
    }
  }

  const fresh = rt.store.addWebhookEvent({
    id: evt.id,
    eventType: evt.event_type,
    resourceId,
    receivedAt: now,
    createTime: evt.create_time ?? null,
    summary: evt.summary ?? null,
    matched,
  });
  rt.log.info("webhook verified", { event: evt.event_type, id: evt.id, duplicate: !fresh, matched });
  return { status: 200, body: "ok" };
}
