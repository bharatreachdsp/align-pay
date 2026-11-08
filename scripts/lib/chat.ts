/** Talks to the running app's /api/chat like the browser does, and rebuilds the assistant's message from the stream. */
export interface ToolOutcome {
  tool: string;
  toolCallId: string;
  input: unknown;
  output: { status?: string; decision_key?: string | null; reason?: string; paypal_id?: string; action_id?: string; next_step?: string } | null;
}

export interface ChatTurn {
  text: string;
  tools: ToolOutcome[];
  message: Record<string, unknown>;
  error: string | null;
}

let n = 0;
const id = () => `m${Date.now().toString(36)}${(n++).toString(36)}`;

export class ChatSession {
  readonly messages: Record<string, unknown>[] = [];
  constructor(
    private readonly base: string,
    readonly customerId: string,
  ) {}

  async send(text: string): Promise<ChatTurn> {
    this.messages.push({ id: id(), role: "user", parts: [{ type: "text", text }] });
    const res = await fetch(`${this.base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: `e2e-${this.customerId}`, messages: this.messages, customerId: this.customerId, trigger: "submit-message" }),
    });
    if (!res.ok || !res.body) return { text: "", tools: [], message: {}, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const raw = await res.text();
    const parts: Record<string, unknown>[] = [];
    const tools = new Map<string, ToolOutcome>();
    let textBuf = "";
    let error: string | null = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      let c: Record<string, unknown>;
      try {
        c = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      switch (c.type) {
        case "text-delta":
          textBuf += String(c.delta ?? "");
          break;
        case "text-end":
          if (textBuf) parts.push({ type: "text", text: textBuf });
          textBuf = "";
          break;
        case "tool-input-available":
          tools.set(String(c.toolCallId), { tool: String(c.toolName), toolCallId: String(c.toolCallId), input: c.input, output: null });
          break;
        case "tool-output-available": {
          const t = tools.get(String(c.toolCallId));
          if (t) {
            t.output = c.output as ToolOutcome["output"];
            parts.push({ type: `tool-${t.tool}`, toolCallId: t.toolCallId, state: "output-available", input: t.input, output: c.output });
          }
          break;
        }
        case "error":
          error = String(c.errorText ?? "error");
          break;
      }
    }
    if (textBuf) parts.push({ type: "text", text: textBuf });
    const message = { id: id(), role: "assistant", parts };
    this.messages.push(message);
    return {
      text: parts.filter((p) => p.type === "text").map((p) => String(p.text)).join("\n"),
      tools: [...tools.values()],
      message,
      error,
    };
  }
}

export const GUARDED_TOOLS = new Set(["refund_order", "create_refund", "create_invoice", "send_invoice", "cancel_sent_invoice"]);
