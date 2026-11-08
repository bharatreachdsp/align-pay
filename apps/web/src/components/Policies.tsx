"use client";
import type { Limits, Rule } from "@align-agent/paypal-guard";
import { useState } from "react";
import type { PolicyView } from "@/server/state";
import { time, useAppState } from "./useAppState";

function RuleEditor({ rule, onChange }: { rule: Rule; onChange: (r: Rule) => void }) {
  const num = (v: string) => (v === "" ? NaN : Number(v));
  switch (rule.kind) {
    case "auto_max_amount":
      return (
        <label className="small">
          {rule.action === "refund.create" ? "Refunds go through on their own up to $" : "Invoices are sent on their own up to $"}
          <input type="number" min={0} value={Number.isNaN(rule.maxUsd) ? "" : rule.maxUsd} onChange={(e) => onChange({ ...rule, maxUsd: num(e.target.value) })} style={{ width: 110, marginLeft: 6 }} data-testid="edit-maxUsd" />
        </label>
      );
    case "per_customer_count":
      return (
        <span className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          At most
          <input type="number" min={0} value={rule.max} onChange={(e) => onChange({ ...rule, max: num(e.target.value) })} style={{ width: 70 }} />
          refund(s) per customer in
          <input type="number" min={1} value={rule.windowDays} onChange={(e) => onChange({ ...rule, windowDays: num(e.target.value) })} style={{ width: 80 }} />
          days, else
          <select value={rule.over} onChange={(e) => onChange({ ...rule, over: e.target.value as "block" | "hold" })}>
            <option value="block">refuse</option>
            <option value="hold">hold for the owner</option>
          </select>
        </span>
      );
    case "block_if_open_dispute":
      return <span className="small muted">No numbers: refuses a refund while the order has an open dispute.</span>;
    case "invoice_terms":
      return (
        <span className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          Terms
          <input type="text" value={rule.allowedTerms.join(", ")} onChange={(e) => onChange({ ...rule, allowedTerms: e.target.value.split(/[,\s]+/).filter(Boolean) as never })} style={{ width: 140 }} />
          max discount %
          <input type="number" min={0} max={100} value={rule.maxDiscountPct} onChange={(e) => onChange({ ...rule, maxDiscountPct: num(e.target.value) })} style={{ width: 80 }} />
          else
          <select value={rule.over} onChange={(e) => onChange({ ...rule, over: e.target.value as "block" | "hold" })}>
            <option value="block">refuse</option>
            <option value="hold">hold for the owner</option>
          </select>
        </span>
      );
  }
}

function PolicyCard({ p, onSaved }: { p: PolicyView; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Limits | null>(p.limits);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmed = p.status === "confirmed";

  async function post(path: "confirm" | "withdraw") {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/policies/${p.decisionKey}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(path === "confirm" ? { limits: draft } : {}),
      });
      if (!r.ok) {
        setError(((await r.json()) as { error?: string }).error ?? "Could not save");
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel" data-testid={`policy-${p.decisionKey}`} data-status={p.status}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="key">{p.decisionKey}</span>
        <span className={`stamp ${confirmed ? "allowed" : "held"}`}>{confirmed ? "Enforced" : "Draft · not enforced"}</span>
      </div>
      <blockquote style={{ fontFamily: "var(--font-head)", fontStyle: "italic", fontSize: "1.05rem", margin: "12px 0 6px" }}>“{p.receipts[0]?.quote ?? p.statement}”</blockquote>
      <p className="small muted" style={{ marginTop: 0 }}>
        Receipt: {p.receipts[0]?.source ?? "ledger"}
        {p.receipts[0]?.at ? ` · ${time(p.receipts[0].at)}` : ""}
      </p>
      {p.limits ? (
        <ul className="small" style={{ paddingLeft: 18 }}>
          {p.plain.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {p.reading ? (
        <details className="small">
          <summary>How Gemini read this rule</summary>
          <p className="muted">{p.reading}</p>
          <p className="muted mono">drafted by {p.draftedBy} · {time(p.draftedAt)}</p>
        </details>
      ) : null}
      <p className="small" data-testid="confirmed-by">
        {confirmed ? (
          <>
            Confirmed by <strong>the {p.confirmedBy}</strong> · {time(p.confirmedAt)}
          </>
        ) : (
          <span className="muted">Not confirmed yet. Nothing is enforced until the store owner confirms it.</span>
        )}
      </p>
      {p.note ? <p className="notice small">{p.note}</p> : null}
      {!p.limits && !p.note ? <p className="notice small">Gemini is drafting the limits…</p> : null}
      {p.limits && (editing || !confirmed) ? (
        <div style={{ display: "grid", gap: 10, borderTop: "1px dashed var(--line-2)", paddingTop: 12 }}>
          {editing && draft
            ? draft.rules.map((r, i) => (
                <RuleEditor key={i} rule={r} onChange={(nr) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === i ? nr : x)) })} />
              ))
            : null}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => post("confirm")} disabled={busy} data-testid={`confirm-${p.decisionKey}`}>
              Confirm
            </button>
            {!editing ? (
              <button className="btn ghost small" onClick={() => setEditing(true)}>
                Edit numbers
              </button>
            ) : null}
            <span className="small muted">You are the store owner here.</span>
          </div>
          {error ? <p className="notice bad small">{error}</p> : null}
        </div>
      ) : p.limits ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            Edit numbers
          </button>
          <button className="btn ghost small" onClick={() => post("withdraw")} disabled={busy} data-testid={`withdraw-${p.decisionKey}`}>
            Withdraw
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function Policies() {
  const { state, refresh } = useAppState(5000);
  const [syncing, setSyncing] = useState(false);
  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/ledger/sync", { method: "POST" });
      await refresh();
    } finally {
      setSyncing(false);
    }
  }
  return (
    <section id="rules">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>The store&apos;s rules</h2>
        <button className="btn ghost small" onClick={sync} disabled={syncing || state?.ledger.syncing} data-testid="sync">
          {syncing || state?.ledger.syncing ? "Syncing with the ledger…" : "Sync with the ledger"}
        </button>
      </div>
      <p className="small muted">
        Each decision from {state?.ledger.mode === "align" ? "your ALIGN workspace" : "the Sample ALIGN ledger"}, with its exact-quote
        receipt, the limits Gemini drafted from it, and whether the store owner confirmed them. Only confirmed limits are enforced.
      </p>
      {state && state.confirmed < state.policies.length ? (
        <p className="notice warn small" data-testid="confirm-hint">
          {state.policies.length - state.confirmed} of {state.policies.length} rules are not confirmed yet. Read each one, check the
          numbers Gemini drafted, and click Confirm.
        </p>
      ) : null}
      {state?.ledger.note ? <p className="notice warn small">{state.ledger.note}</p> : null}
      <div className="grid two">
        {(state?.policies ?? []).map((p) => (
          <PolicyCard key={`${p.decisionKey}-${p.status}-${p.confirmedAt}`} p={p} onSaved={refresh} />
        ))}
      </div>
      {state && state.policies.length === 0 ? <p className="muted">No decisions yet. {state.ledger.syncing ? "Syncing…" : ""}</p> : null}
    </section>
  );
}
