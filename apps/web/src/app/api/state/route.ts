import { appState } from "@/server/state";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(appState());
}
