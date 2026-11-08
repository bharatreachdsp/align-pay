import { type OrderItem, type Scenario, createCardOrder, newActionId, orderMoney } from "@align-agent/paypal-guard";
import { runtime } from "./runtime";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const tag = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

interface SeedOrder {
  key: string;
  base: "asha" | "ben";
  label: string;
  items: (OrderItem & { sku: string })[];
  shippingUsd: number;
}

/** Asha's damaged $180 chai case, and Ben's $25 and $40 orders. All fictional, all on the sandbox card path. */
const ORDERS: SeedOrder[] = [
  { key: "asha_case", base: "asha", label: "Chai Case (24 packs)", items: [{ sku: "KK-CASE", name: "Chai Case (24 packs)", quantity: 1, unitUsd: 180 }], shippingUsd: 0 },
  { key: "ben_25", base: "ben", label: "Kesar Chai Blend + shipping", items: [{ sku: "KK-CHAI", name: "Kesar Chai Blend", quantity: 1, unitUsd: 18 }], shippingUsd: 7 },
  { key: "ben_40", base: "ben", label: "2 × Kesar Chai Blend + shipping", items: [{ sku: "KK-CHAI", name: "Kesar Chai Blend", quantity: 2, unitUsd: 18 }], shippingUsd: 4 },
];

/**
 * "Start a demo": fresh fictional customers, their captured orders (card path: no buyer click), then Ben's first
 * refund ($20 on the $25 order) through the guard, so his 30-day history has one refund in it.
 */
export async function startDemo(): Promise<Scenario> {
  const rt = runtime();
  await rt.ready;
  const t = tag();
  const s: Scenario = {
    id: `scn_${t}`,
    tag: t,
    createdAt: new Date().toISOString(),
    customers: { asha: `asha-${t}`, ben: `ben-${t}`, chen: `chen-${t}` },
    orders: {},
    status: "running",
  };
  rt.store.putScenario(s);
  rt.store.setKv("current_scenario", s.id);
  void (async () => {
    try {
      for (const o of ORDERS) {
        const customerId = s.customers[o.base]!;
        const order = await createCardOrder(rt.paypal, {
          customId: customerId,
          description: `Kettle & Kesar (fictional store) · ${o.label}`,
          items: o.items,
          shippingUsd: o.shippingUsd,
          requestId: `order-${newActionId()}`,
        });
        const m = orderMoney(order);
        if (order.status !== "COMPLETED" || !m.capture) throw new Error(`PayPal did not complete the order (${order.status}).`);
        rt.store.putOrder({
          orderId: order.id,
          captureId: m.capture.id,
          customerId,
          scenarioId: s.id,
          items: o.items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, unitUsd: i.unitUsd })),
          totalUsd: m.capturedUsd,
          createdAt: new Date().toISOString(),
          source: "scenario",
          label: o.label,
        });
        s.orders[o.key] = order.id;
        rt.store.putScenario(s);
      }
      const earlier = await rt.guard.handle({
        id: newActionId(),
        type: "refund.create",
        tool: "refund_order",
        requestedBy: "support-agent",
        customerId: s.customers.ben!,
        scenarioId: s.id,
        args: { order_id: s.orders.ben_25, amount_usd: 20, reason: "One pack arrived opened (an earlier conversation)" },
        target: { orderId: s.orders.ben_25! },
        requested: { amountUsd: 20 },
      });
      s.status = "ready";
      if (earlier.status !== "allowed") s.error = `Ben's earlier $20 refund was ${earlier.status}: ${earlier.reason}`;
      rt.store.putScenario(s);
    } catch (e) {
      s.status = "failed";
      s.error = (e as Error).message.slice(0, 300);
      rt.store.putScenario(s);
      rt.log.error("start demo failed", { error: s.error });
    }
  })();
  return s;
}

export function currentScenario(): Scenario | null {
  const rt = runtime();
  const id = rt.store.getKv<string>("current_scenario");
  return id ? rt.store.getScenario(id) : null;
}
