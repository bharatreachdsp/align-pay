import { withdrawPolicy } from "@align-agent/paypal-guard";
import { runtime } from "@/server/runtime";

/** The store owner withdraws a confirmation: the limits go back to draft and stop being enforced. */
export async function POST(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  try {
    return Response.json(withdrawPolicy(runtime().store, key));
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 300) }, { status: 400 });
  }
}
