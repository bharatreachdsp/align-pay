import { card } from "@/server/state";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = card(id);
  return c ? Response.json(c) : Response.json({ error: "not found" }, { status: 404 });
}
