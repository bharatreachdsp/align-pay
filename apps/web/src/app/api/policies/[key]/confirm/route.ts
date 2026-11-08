import { confirmPolicy } from "@align-agent/paypal-guard";
import { z } from "zod";
import { runtime } from "@/server/runtime";

const Body = z.object({ limits: z.unknown() });

/** The store owner clicks Confirm on the owner page (optionally after editing the numbers). */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the limits being confirmed." }, { status: 400 });
  try {
    return Response.json(confirmPolicy(runtime().store, key, parsed.data.limits));
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 300) }, { status: 400 });
  }
}
