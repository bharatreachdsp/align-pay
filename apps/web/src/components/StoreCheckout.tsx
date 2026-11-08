"use client";
import { useEffect, useRef, useState } from "react";
import { useAppState } from "./useAppState";

const PRODUCTS = [
  { sku: "KK-CHAI", name: "Kesar Chai Blend", price: 18, note: "Assam, saffron, cardamom. 100 g." },
  { sku: "KK-DARJ", name: "Darjeeling First Flush", price: 26, note: "Spring pluck, light and floral. 100 g." },
  { sku: "KK-KETTLE", name: "Brass Tea Kettle", price: 64, note: "Hand-beaten brass, 1.2 litres." },
  { sku: "KK-CASE", name: "Chai Case (24 packs)", price: 180, note: "For cafés: 24 packs of the Kesar blend." },
];

type PaypalNs = {
  Buttons: (o: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
};

/** The store's checkout: PayPal's JavaScript SDK (v5) buttons; the server creates and captures the order. */
export function StoreCheckout() {
  const { state } = useAppState(10000);
  const [sku, setSku] = useState("KK-CHAI");
  const [qty, setQty] = useState(1);
  const [buyer, setBuyer] = useState<string>("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const customers = state?.customers ?? [];
  const buyerId = buyer || customers[0]?.id || "";

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((j: { paypalClientId: string | null }) => setClientId(j.paypalClientId));
  }, []);

  useEffect(() => {
    if (!clientId || !box.current || !buyerId) return;
    const el = box.current;
    let buttons: ReturnType<PaypalNs["Buttons"]> | null = null;
    const render = () => {
      const paypal = (window as unknown as { paypal?: PaypalNs }).paypal;
      if (!paypal) return;
      el.innerHTML = "";
      buttons = paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay" },
        createOrder: async () => {
          const r = await fetch("/api/store/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId: buyerId, items: [{ sku, quantity: qty }] }),
          });
          const j = (await r.json()) as { id?: string; error?: string };
          if (!j.id) throw new Error(j.error ?? "order failed");
          return j.id;
        },
        onApprove: async (data: { orderID: string }) => {
          const r = await fetch(`/api/store/orders/${data.orderID}/capture`, { method: "POST" });
          const j = (await r.json()) as { status?: string; captureId?: string; error?: string };
          setMsg(j.status === "COMPLETED" ? `Paid in the sandbox. PayPal capture ${j.captureId}.` : `PayPal answered: ${j.error ?? j.status}`);
        },
        onError: () => setMsg("PayPal could not complete the payment."),
      });
      void buttons.render(el);
    };
    const id = "paypal-sdk";
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
      s.onload = render;
      document.body.appendChild(s);
    } else render();
    return () => {
      buttons?.close?.();
    };
  }, [clientId, buyerId, sku, qty]);

  const product = PRODUCTS.find((p) => p.sku === sku)!;
  return (
    <div className="grid two">
      <div className="grid two">
        {PRODUCTS.map((p) => (
          <button key={p.sku} className="panel product" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", outline: p.sku === sku ? "2px solid var(--terracotta)" : undefined }} onClick={() => setSku(p.sku)}>
            <div className="art" aria-hidden="true">
              <svg width="54" height="54" viewBox="0 0 32 32" fill="none">
                <path d="M7 12h16v7a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-7Z" stroke="var(--terracotta)" strokeWidth="1.8" />
                <path d="M23 14h2.5a3 3 0 0 1 0 6H23" stroke="var(--terracotta)" strokeWidth="1.8" />
                <path d="M12 5c0 2 2 2 2 4M16 4c0 2 2 2 2 4" stroke="var(--ink-2)" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            <strong>{p.name}</strong>
            <span className="small muted">{p.note}</span>
            <span className="price">${p.price}</span>
          </button>
        ))}
      </div>
      <div className="panel">
        <h3>Checkout</h3>
        <p className="small muted">PayPal sandbox: use a sandbox buyer account or one of PayPal&apos;s test cards. No real money.</p>
        <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          <label className="small">
            Buying as{" "}
            <select value={buyerId} onChange={(e) => setBuyer(e.target.value)}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id})
                </option>
              ))}
            </select>
          </label>
          <label className="small">
            Quantity <input type="number" min={1} max={50} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} style={{ width: 80 }} />
          </label>
          <div className="price">
            {qty} × {product.name}: ${qty * product.price}
          </div>
        </div>
        {!customers.length ? <p className="notice small">Start a demo first: it creates the fictional customers.</p> : <div ref={box} data-testid="paypal-buttons" />}
        {msg ? <p className="notice small">{msg}</p> : null}
      </div>
    </div>
  );
}
