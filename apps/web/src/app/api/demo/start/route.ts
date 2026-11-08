import { startDemo } from "@/server/scenario";

export async function POST() {
  try {
    return Response.json(await startDemo());
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
