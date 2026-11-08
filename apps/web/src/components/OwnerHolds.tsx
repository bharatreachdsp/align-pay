"use client";
import type { ReceiptCard as Card } from "@align-agent/paypal-guard";
import { useCallback, useEffect, useState } from "react";
import { ReceiptCard } from "./ReceiptCard";

function HoldActions({ card, onDone }: { card: Card; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function act(kind: "approve" | "deny") {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await fetch(`/api/actions/${card.actionId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { note } : {}),
      });
      const j = (await r.json()) as { result?: { status: string; reason: string } };
      if (j.result && j.result.status === "held") setMsg(j.result.reason);
      onDone();
    } finally {
      setBusy(null);
    }
  }
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <input type="text" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn ok small" onClick={() => act("approve")} disabled={!!busy} data-testid="approve">
          {busy === "approve" ? "Checking PayPal again…" : "Approve"}
        </button>
        <button className="btn no small" onClick={() => act("deny")} disabled={!!busy} data-testid="deny">
          Decline
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Approving reads PayPal&apos;s facts again first. A rule that blocks still blocks.
      </p>
      {msg ? <p className="notice warn small">{msg}</p> : null}
    </div>
  );
}

export function OwnerHolds() {
  const [held, setHeld] = useState<Card[] | null>(null);
  const [recent, setRecent] = useState<Card[]>([]);
  const load = useCallback(async () => {
    const [h, all] = await Promise.all([
      fetch("/api/actions?status=held", { cache: "no-store" }).then((r) => r.json() as Promise<Card[]>),
      fetch("/api/actions", { cache: "no-store" }).then((r) => r.json() as Promise<Card[]>),
    ]);
    setHeld(h);
    setRecent(all.filter((c) => c.approver).slice(0, 4));
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <section>
      <h2>Waiting for you {held ? <span className="chip">{held.length}</span> : null}</h2>
      {held && held.length === 0 ? <p className="muted">Nothing is waiting. Held refunds and invoices appear here.</p> : null}
      <div className="grid two" data-testid="holds">
        {(held ?? []).map((c) => (
          <ReceiptCard key={c.actionId} actionId={c.actionId} initial={c}>
            <HoldActions card={c} onDone={load} />
          </ReceiptCard>
        ))}
      </div>
      {recent.length ? (
        <>
          <h3 style={{ marginTop: 28 }}>Decided recently</h3>
          <div className="grid two">
            {recent.map((c) => (
              <ReceiptCard key={c.actionId} actionId={c.actionId} initial={c} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
