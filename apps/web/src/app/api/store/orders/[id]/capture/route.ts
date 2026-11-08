import { captureOrder, newActionId, orderMoney, safePayPalId } from "@align-agent/paypal-guard";
import { runtime } from "@/server/runtime";
import { currentScenario } from "@/server/scenario";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safePayPalId((await ctx.params).id);
  const rt = runtime();
  const pending = id ? rt.store.getKv<{ customerId: string; items: { sku: string; name: string; quantity: number; unitUsd: number }[] }>(`pending_order:${id}`) : null;
  if (!id || !pending) return Response.json({ error: "unknown order" }, { status: 404 });
  try {
    const order = await captureOrder(rt.paypal, id, `capture-${newActionId()}`);
    const m = orderMoney(order);
    const scenario = currentScenario();
    rt.store.putOrder({
      orderId: order.id,
      captureId: m.capture?.id ?? null,
      customerId: pending.customerId,
      ...(scenario ? { scenarioId: scenario.id } : {}),
      items: pending.items,
      totalUsd: m.capturedUsd,
      createdAt: new Date().toISOString(),
      source: "store",
      label: "store checkout",
    });
    return Response.json({ status: order.status, captureId: m.capture?.id ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
