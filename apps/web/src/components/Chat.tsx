"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReceiptCard } from "./ReceiptCard";

const GUARDED = new Set(["refund_order", "create_refund", "create_invoice", "send_invoice", "cancel_sent_invoice"]);

type ToolPart = { type: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string };

function ToolView({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  if (GUARDED.has(name)) {
    const out = part.output as { action_id?: string } | undefined;
    if (part.state === "output-available" && out?.action_id) return <ReceiptCard actionId={out.action_id} />;
    if (part.state === "output-error") return <div className="toolnote">ALIGN Pay could not check {name}: {part.errorText}</div>;
    return <div className="toolnote">⏳ ALIGN Pay is checking {name.replace(/_/g, " ")} against the owner&apos;s decisions…</div>;
  }
  return <div className="toolnote">↳ looked up {name.replace(/_/g, " ")}{part.state === "output-available" ? "" : "…"}</div>;
}

const storageKey = (customerId: string) => `align-pay-chat:${customerId}`;

/** The conversation survives a trip to the owner page (kept in this tab's session storage). */
function savedMessages(customerId: string): UIMessage[] {
  try {
    const raw = typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey(customerId));
    return raw ? (JSON.parse(raw) as UIMessage[]) : [];
  } catch {
    return [];
  }
}

export function Chat({ customerId, suggestions }: { customerId: string; suggestions: string[] }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", body: { customerId } }), [customerId]);
  const initial = useMemo(() => savedMessages(customerId), [customerId]);
  const { messages, sendMessage, status, error } = useChat<UIMessage>({ id: `chat-${customerId}`, transport, messages: initial });
  useEffect(() => {
    if (status !== "ready") return;
    try {
      window.sessionStorage.setItem(storageKey(customerId), JSON.stringify(messages));
    } catch {
      // storage full or disabled: the conversation just won't survive navigation
    }
  }, [messages, status, customerId]);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = (t: string) => {
    if (!t.trim() || busy) return;
    void sendMessage({ text: t.trim() });
    setText("");
  };

  return (
    <div className="chat" data-testid="chat">
      <div className="log" ref={log}>
        {messages.length === 0 ? (
          <p className="muted small">Pick a suggested message below, or write your own. The agent runs on Gemini; money only moves through ALIGN Pay.</p>
        ) : null}
        {messages.map((m) =>
          m.parts.map((p, i) => {
            if (p.type === "text") {
              if (!p.text.trim()) return null;
              return (
                <div key={`${m.id}-${i}`} className={`bubble ${m.role}`} data-testid={`bubble-${m.role}`}>
                  {p.text}
                </div>
              );
            }
            if (p.type.startsWith("tool-")) return <ToolView key={`${m.id}-${i}`} part={p as unknown as ToolPart} />;
            return null;
          }),
        )}
        {status === "submitted" ? <div className="toolnote">The agent is thinking…</div> : null}
        {error ? <div className="notice bad small">The assistant could not answer: {error.message}</div> : null}
      </div>
      <div className="suggestions">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => send(s)} disabled={busy} data-testid="suggestion">
            {s}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write as the customer…" aria-label="Message" data-testid="chat-input" />
        <button className="btn" type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
