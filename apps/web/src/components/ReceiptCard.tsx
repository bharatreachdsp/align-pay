"use client";
import type { ReceiptCard as Card } from "@align-agent/paypal-guard";
import { useEffect, useState } from "react";
import { time } from "./useAppState";

const STAMP: Record<Card["status"], string> = {
  allowed: "Allowed",
  held: "Held",
  blocked: "Blocked",
  denied: "Declined",
  failed: "Failed",
};

/** One guard outcome: status, decision key, the quoted rule, the PayPal facts used, and the PayPal id once executed. */
export function ReceiptCard({ actionId, initial, children }: { actionId: string; initial?: Card; children?: React.ReactNode }) {
  const [card, setCard] = useState<Card | null>(initial ?? null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/actions/${actionId}`, { cache: "no-store" });
        if (r.ok && !stop) setCard((await r.json()) as Card);
      } catch {
        // retry on the next tick
      }
    };
    if (!initial) void load();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [actionId, initial]);
  useEffect(() => {
    if (initial) setCard(initial);
  }, [initial]);

  if (!card) return <div className="receipt muted small">Checking with ALIGN Pay…</div>;
  return (
    <article className="receipt" data-testid="receipt-card" data-status={card.status} data-action={card.actionId}>
      <div className="head">
        <div>
          <div className="title">{card.title}</div>
          <div className="small muted">
            {card.customerId ? <span className="mono">{card.customerId}</span> : null} · {time(card.createdAt)}
          </div>
        </div>
        <span className={`stamp ${card.status}`} data-testid="receipt-status">
          {STAMP[card.status]}
        </span>
      </div>
      {card.decisionKey ? (
        <div className="rule" data-testid="receipt-rule">
          <div className="small muted">
            Decision <span className="key" data-testid="decision-key">{card.decisionKey}</span>
            {card.receipts[0] ? <span> · receipt from {card.receipts[0].source}</span> : null}
          </div>
          {card.receipts.slice(0, 1).map((r, i) => (
            <blockquote key={i}>“{r.quote}”</blockquote>
          ))}
        </div>
      ) : (
        <div className="rule small muted">No confirmed decision covers this. Nobody decided it, so a person has to.</div>
      )}
      <p className="reason">{card.explanation ?? card.reason}</p>
      {card.explanation && card.explanation !== card.reason ? <p className="small muted">{card.reason}</p> : null}
      {card.alternative && card.status !== "allowed" ? <p className="small"><strong>Next step:</strong> {card.alternative}</p> : null}
      <dl className="facts" aria-label="PayPal facts used">
        {card.facts.map((f) => (
          <div key={f.label} style={{ display: "contents" }}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {children}
      <div className="foot">
        {card.paypalId ? (
          <span>
            {card.paypalLabel} <span className="paypal-id" data-testid="paypal-id">{card.paypalId}</span>
          </span>
        ) : null}
        {card.approver ? (
          <span>
            {card.status === "denied" ? "Declined" : "Approved"} by {card.approver} {time(card.decidedAt)}
            {card.approverNote ? ` · “${card.approverNote}”` : ""}
          </span>
        ) : null}
        {card.webhookVerifiedAt ? (
          <span className="verified" data-testid="webhook-verified">✓ webhook verified {time(card.webhookVerifiedAt)}</span>
        ) : card.status === "allowed" && card.type === "refund.create" ? (
          <span>awaiting PayPal's webhook</span>
        ) : null}
        <span className="mono">{card.actionId}</span>
      </div>
    </article>
  );
}
