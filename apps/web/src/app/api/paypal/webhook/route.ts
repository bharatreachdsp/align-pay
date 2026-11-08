import { handleWebhook } from "@/server/webhook";

/** PayPal webhooks arrive here through the tunnel. The raw body is read as a string and verified with PayPal. */
export async function POST(req: Request) {
  const raw = await req.text();
  const out = await handleWebhook(raw, (n) => req.headers.get(n));
  return new Response(out.body, { status: out.status });
}
