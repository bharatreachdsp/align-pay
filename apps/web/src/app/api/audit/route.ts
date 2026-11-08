import { lastAudit, runAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(lastAudit());
}

export async function POST() {
  try {
    return Response.json(await runAudit());
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
