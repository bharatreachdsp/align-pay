import { runtime } from "@/server/runtime";
import { appState } from "@/server/state";

export async function POST() {
  await runtime().syncLedgerNow();
  return Response.json(appState());
}
