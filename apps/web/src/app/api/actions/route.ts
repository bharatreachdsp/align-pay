import type { ActionStatus } from "@align-agent/paypal-guard";
import { cards } from "@/server/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ActionStatus | null;
  const customerId = url.searchParams.get("customer");
  return Response.json(cards({ ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) }));
}
