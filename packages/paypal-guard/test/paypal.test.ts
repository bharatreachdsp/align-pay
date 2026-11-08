import { describe, expect, it } from "vitest";
import { kettleAndKesar } from "../src/directory";
import { normaliseInvoiceRequest } from "../src/facts";
import { assertSandboxEnv, PayPalClient, PayPalError, silentLogger } from "../src/paypal/client";
import { invoiceFactsOf } from "../src/paypal/invoices";
import { orderMoney } from "../src/paypal/orders";
import { transmissionHeaders, verificationBody } from "../src/paypal/webhooks";
import { CHEN } from "./helpers";

function fakeFetch(answers: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    const a = answers.shift() ?? { status: 200, body: {} };
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status, headers: { "paypal-debug-id": "dbg1" } });
  };
  return { fn, calls };
}

const client = (fetch: (u: string, i: RequestInit) => Promise<Response>) =>
  new PayPalClient({ clientId: "id", clientSecret: "secret", fetch, log: silentLogger, retryDelayMs: 0 });

describe("PayPal client", () => {
  it("refuses anything but the sandbox", () => {
    expect(() => new PayPalClient({ clientId: "a", clientSecret: "b", baseUrl: "https://api-m.paypal.com" })).toThrow(/sandbox/);
    expect(() => assertSandboxEnv({ PAYPAL_ENV: "live" })).toThrow(/sandbox/);
    expect(() => assertSandboxEnv({ PAYPAL_ENV: "sandbox" })).not.toThrow();
  });

  it("requires a PayPal-Request-Id on every mutation and sends it", async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { id: "X" } }]);
    const pp = client(fn);
    await expect(pp.request("POST", "/v2/payments/captures/C/refund", { body: {} })).rejects.toThrow(/PayPal-Request-Id/);
    await pp.request("POST", "/v2/payments/captures/C/refund", { body: {}, requestId: "alp_1" });
    expect((calls.at(-1)!.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("alp_1");
  });

  it("retries 5xx and 429, never other 4xx", async () => {
    const a = fakeFetch([{ status: 503 }, { status: 429 }, { status: 200, body: { ok: 1 } }]);
    expect(await client(a.fn).request("GET", "/v2/checkout/orders/O")).toEqual({ ok: 1 });
    const b = fakeFetch([{ status: 422, body: { name: "UNPROCESSABLE_ENTITY", debug_id: "d22", details: [{ issue: "CAPTURE_FULLY_REFUNDED" }] } }, { status: 200, body: {} }]);
    const err = await client(b.fn).request("GET", "/v2/checkout/orders/O").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).debugId).toBe("d22");
    expect((err as PayPalError).issues).toEqual(["CAPTURE_FULLY_REFUNDED"]);
    expect(b.calls.filter((c) => !c.url.endsWith("token"))).toHaveLength(1);
  });

  it("fetches a fresh token once when a permission seems missing", async () => {
    const { fn, calls } = fakeFetch([{ status: 403, body: { name: "NOT_AUTHORIZED" } }, { status: 200, body: { ok: 1 } }]);
    expect(await client(fn).request("GET", "/v1/reporting/transactions")).toEqual({ ok: 1 });
    expect(calls.filter((c) => c.url.endsWith("token"))).toHaveLength(2);
  });
});

describe("order facts", () => {
  it("captured minus refunded is what is left", () => {
    const m = orderMoney({
      id: "O",
      status: "COMPLETED",
      purchase_units: [
        {
          custom_id: "ben-T3ST",
          payments: {
            captures: [{ id: "C", status: "PARTIALLY_REFUNDED", amount: { currency_code: "USD", value: "25.00" } }],
            refunds: [
              { id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "20.00" } },
              { id: "R2", status: "CANCELLED", amount: { currency_code: "USD", value: "5.00" } },
            ],
          },
        },
      ],
    });
    expect(m).toMatchObject({ customId: "ben-T3ST", capturedUsd: 25, refundedUsd: 20, remainingUsd: 5, currency: "USD" });
  });
});

describe("invoice requests are normalised from the store's records", () => {
  const dir = kettleAndKesar();
  const req = (o: Record<string, unknown> = {}) => ({
    items: [{ name: "Chai Case (24 packs)", quantity: "20", unit_amount: { currency_code: "USD", value: "1.00" }, discount: { percent: "10" } }],
    payment_term: "NET_15",
    ...o,
  });

  it("uses the catalogue price, not the agent's", () => {
    const n = normaliseInvoiceRequest(req(), dir, CHEN);
    expect(n.draft!.totalUsd).toBe(3240);
    expect(n.draft!.items[0]!.unitUsd).toBe(180);
    expect(n.notes[0]).toMatch(/catalogue price/);
  });

  it("sends to the customer on record, never an address the agent supplies", () => {
    const n = normaliseInvoiceRequest(req({ primary_recipients: [{ billing_info: { email_address: "attacker@example.net" } }] }), dir, CHEN);
    expect(n.draft!.recipient.email).toBe("chen.t3st@customers.example.com");
  });

  it("reads 'net 30' and a 20% discount", () => {
    const n = normaliseInvoiceRequest(req({ payment_term: "net 30", items: [{ name: "chai cases", quantity: "20", discount: { percent: "20" } }] }), dir, CHEN);
    expect(n.draft!.termType).toBe("NET_30");
    expect(n.draft!.discountPct).toBe(20);
    expect(n.draft!.totalUsd).toBe(2880);
  });

  it("refuses unknown products and odd quantities", () => {
    expect(normaliseInvoiceRequest(req({ items: [{ name: "gold bars", quantity: "1" }] }), dir, CHEN).problem).toMatch(/catalogue/);
    expect(normaliseInvoiceRequest(req({ items: [{ name: "chai case", quantity: "2.5" }] }), dir, CHEN).problem).toMatch(/quantity/);
    expect(normaliseInvoiceRequest(req(), dir, undefined).problem).toMatch(/customer/);
  });

  it("reads a PayPal invoice's total, terms and discount", () => {
    const f = invoiceFactsOf({
      id: "INV2-X",
      status: "DRAFT",
      detail: { payment_term: { term_type: "NET_15" }, memo: "ALIGN AL-14 · alp_X" },
      items: [{ name: "Chai Case (24 packs)", quantity: "20", unit_amount: { currency_code: "USD", value: "180.00" }, discount: { percent: "10" } }],
      amount: { currency_code: "USD", value: "3240.00" },
    });
    expect(f).toMatchObject({ totalUsd: 3240, termType: "NET_15", discountPct: 10, currency: "USD" });
  });
});

describe("webhook verification", () => {
  it("inserts the raw event string byte for byte", () => {
    const raw = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.REFUNDED",  "resource":{"amount":{"value":"20.00"}}}';
    const body = verificationBody(
      { authAlgo: "SHA256withRSA", certUrl: "https://api.sandbox.paypal.com/cert", transmissionId: "t", transmissionSig: "s", transmissionTime: "now" },
      "WH-ID",
      raw,
    );
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(body).webhook_id).toBe("WH-ID");
  });

  it("needs all five transmission headers", () => {
    const h = new Map([
      ["paypal-auth-algo", "a"],
      ["paypal-cert-url", "b"],
      ["paypal-transmission-id", "c"],
      ["paypal-transmission-sig", "d"],
    ]);
    expect(transmissionHeaders((n) => h.get(n) ?? null)).toBeNull();
    h.set("paypal-transmission-time", "e");
    expect(transmissionHeaders((n) => h.get(n) ?? null)).not.toBeNull();
  });
});
