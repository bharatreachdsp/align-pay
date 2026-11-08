import { type NextRequest, NextResponse } from "next/server";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * ALIGN Pay is a local app. The cloudflared tunnel exists only so PayPal can deliver webhooks, so a request that
 * arrives through it (Cloudflare headers) or for any host other than localhost may reach only the webhook endpoint.
 * Everything else (approving holds, confirming limits, the agent) answers only on localhost.
 */
export function proxy(req: NextRequest) {
  const viaTunnel = req.headers.has("cf-ray") || req.headers.has("cf-connecting-ip");
  const host = req.headers.get("host") ?? "";
  const local = LOCAL.test(host) && !viaTunnel;
  if (local) {
    // No other website may make a browser call this API (approve holds, confirm limits, reset).
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.get("origin");
      const site = req.headers.get("sec-fetch-site");
      const sameHost = origin ? LOCAL.test(origin.replace(/^https?:\/\//, "")) && origin.replace(/^https?:\/\//, "").split(":")[1] === host.split(":")[1] : true;
      if (!sameHost || site === "cross-site") return new NextResponse("Cross-site requests are refused.", { status: 403 });
    }
    return NextResponse.next();
  }
  if (req.method === "POST" && req.nextUrl.pathname === "/api/paypal/webhook") return NextResponse.next();
  return new NextResponse("ALIGN Pay answers only on localhost. Through the tunnel, only PayPal's webhooks are accepted.", { status: 403 });
}

export const config = { matcher: "/:path*" };
