import { runtime } from "@/server/runtime";

/** Clears local demo data (actions, orders, scenarios, webhook events). Policies and their confirmations stay. */
export async function POST() {
  const rt = runtime();
  rt.store.resetDemo();
  rt.store.setKv("current_scenario", null);
  return Response.json({ ok: true });
}
