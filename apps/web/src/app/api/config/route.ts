export const dynamic = "force-dynamic";

/** The PayPal client id is public by design (the JavaScript SDK needs it in the browser). Nothing else is exposed. */
export async function GET() {
  return Response.json({ paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null });
}
