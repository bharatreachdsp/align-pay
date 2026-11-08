import { type NextRequest, NextResponse } from "next/server";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * ALIGN Pay is a local app. The cloudflared tunnel exists only so PayPal can deliver webhooks, so a request that
 * arrives through it (Cloudflare headers) or for any host other than localhost may reach only the webhook endpoint.
 * Everything else (approving holds, confirming limits, the agent) answers only on localhost.
 */
export function proxy(req: NextRequest) {
  const viaTunnel = req.headers.has("cf-ray") || req.headers.has("cf-connecting-ip");
  const local = LOCAL.test(req.headers.get("host") ?? "") && !viaTunnel;
  if (local) return NextResponse.next();
  if (req.method === "POST" && req.nextUrl.pathname === "/api/paypal/webhook") return NextResponse.next();
  return new NextResponse("ALIGN Pay answers only on localhost. Through the tunnel, only PayPal's webhooks are accepted.", { status: 403 });
}

export const config = { matcher: "/:path*" };
