"use client";
import Link from "next/link";
import { useState } from "react";
import { useAppState } from "./useAppState";

/** Creates a fresh fictional scenario: Asha's and Ben's captured orders, then Ben's first refund through the guard. */
export function StartDemo() {
  const { state, refresh } = useAppState(2000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = state?.scenario;
  const running = busy || s?.status === "running";
  const total = state?.policies.length ?? 4;
  const rulesReady = !!state && state.policies.length > 0 && state.confirmed === total;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/demo/start", { method: "POST" });
      if (!r.ok) setError(((await r.json()) as { error?: string }).error ?? "Could not start");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    await fetch("/api/demo/reset", { method: "POST" });
    await refresh();
  }

  return (
    <div className="panel" data-testid="start-demo">
      {!rulesReady ? (
        <div style={{ marginBottom: 18 }} data-testid="confirm-step">
          <h3>1 · Review and confirm the store&apos;s rules</h3>
          <p className="muted small">
            The store owner&apos;s four rules come from the Sample ALIGN ledger. Gemini has drafted limits from each; nothing is
            enforced until the store owner confirms them. {state ? `${state.confirmed} of ${total} confirmed.` : ""}
          </p>
          <Link className="btn" href="/owner#rules" data-testid="review-rules">
            Review and confirm the store&apos;s rules
          </Link>
        </div>
      ) : null}
      <h3>{rulesReady ? "Run the demo" : "2 · Run the demo"}</h3>
      <p className="muted small">
        Creates fresh fictional customers and captures their orders in the PayPal sandbox with a test card, then makes Ben's
        first refund ($20) through the guard. Takes about ten seconds. Reset clears open holds; money that already moved stays
        on the record for the audit.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" onClick={start} disabled={running || !rulesReady} data-testid="start-demo-button">
          {running ? "Creating orders in PayPal…" : "Start a demo"}
        </button>
        {s ? (
          <button className="btn ghost small" onClick={reset} disabled={running}>
            Reset
          </button>
        ) : null}
      </div>
      {s?.status === "ready" ? (
        <p className="small" data-testid="demo-ready">
          Ready: scenario <span className="mono">{s.tag}</span>. {s.error ? <span className="muted">{s.error} </span> : null}
          <Link href="/support">Open the support chat →</Link>
        </p>
      ) : null}
      {s?.status === "failed" ? <p className="notice bad small">The demo could not start: {s.error}</p> : null}
      {error ? <p className="notice bad small">{error}</p> : null}
    </div>
  );
}
