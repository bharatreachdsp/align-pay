import { createButtonOrder, newActionId } from "@align-agent/paypal-guard";
import { z } from "zod";
import { runtime } from "@/server/runtime";

const Body = z.object({
  customerId: z.string().regex(/^(asha|ben|chen)-[A-Z0-9]{4,12}$/),
  items: z.array(z.object({ sku: z.string(), quantity: z.number().int().min(1).max(50) })).min(1).max(10),
});

/** The store page's PayPal buttons create the order here; prices come from the catalogue. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad order" }, { status: 400 });
  const rt = runtime();
  const items = parsed.data.items.map((i) => {
    const p = rt.directory.products.find((x) => x.sku === i.sku);
    if (!p) throw new Error("unknown product");
    return { sku: p.sku, name: p.name, quantity: i.quantity, unitUsd: p.priceUsd };
  });
  const order = await createButtonOrder(rt.paypal, {
    customId: parsed.data.customerId,
    description: "Kettle & Kesar (fictional store)",
    items,
    requestId: `order-${newActionId()}`,
  });
  rt.store.setKv(`pending_order:${order.id}`, { customerId: parsed.data.customerId, items });
  return Response.json({ id: order.id });
}
