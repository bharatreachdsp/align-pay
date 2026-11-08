import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { customerSchema, supportTools, systemPrompt } from "@/server/agent";
import { runtime } from "@/server/runtime";
import { currentScenario } from "@/server/scenario";

export const maxDuration = 120;

/** The support agent: Gemini Pro with the guarded PayPal tools, at most 8 tool steps per turn. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { messages?: UIMessage[]; customerId?: string } | null;
  const who = customerSchema.safeParse(body ?? {});
  if (!who.success || !Array.isArray(body?.messages)) return Response.json({ error: "Pick a customer first." }, { status: 400 });
  const rt = runtime();
  await rt.ready;
  if (!rt.pro) return Response.json({ error: "The support agent needs a Gemini key (GOOGLE_GENERATIVE_AI_API_KEY in .env)." }, { status: 503 });
  // Only the current demo's customers can be chatted as.
  const scenario = currentScenario();
  const customer = rt.directory.customer(who.data.customerId);
  if (!customer || !scenario || !Object.values(scenario.customers).includes(customer.id)) {
    return Response.json({ error: "That customer is not part of the current demo. Start a demo first." }, { status: 400 });
  }
  const tools = supportTools(customer.id, scenario.id);
  const result = streamText({
    model: rt.pro,
    system: systemPrompt(customer),
    messages: await convertToModelMessages(body!.messages!.slice(-30), { tools }),
    tools,
    stopWhen: stepCountIs(8),
    maxRetries: 2,
  });
  return result.toUIMessageStreamResponse({
    onError: (e) => {
      rt.log.warn("support agent error", { error: (e as Error)?.message?.slice(0, 200) });
      return "The assistant could not answer just now. Please try again.";
    },
  });
}
