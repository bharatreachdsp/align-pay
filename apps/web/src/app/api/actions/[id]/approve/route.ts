import { z } from "zod";
import { runtime } from "@/server/runtime";
import { card } from "@/server/state";

const Body = z.object({ note: z.string().max(300).optional() });

/** The owner approves a hold: the guard reads PayPal's facts again, block rules still block, then it executes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  try {
    const r = await runtime().guard.approve(id, { approver: "store owner", ...(body.success && body.data.note ? { note: body.data.note } : {}) });
    return Response.json({ result: r, card: card(id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 200) }, { status: 404 });
  }
}
