import { confirmPolicy } from "@align-agent/paypal-guard";
import { z } from "zod";
import { runtime } from "@/server/runtime";

const Body = z.object({ limits: z.unknown(), by: z.enum(["local user", "store owner"]) });

/** A person confirms (optionally edited) limits on the owner page. Marked with who did it. */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send limits and who is confirming." }, { status: 400 });
  try {
    const p = confirmPolicy(runtime().store, key, parsed.data.limits, parsed.data.by);
    return Response.json(p);
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 300) }, { status: 400 });
  }
}
