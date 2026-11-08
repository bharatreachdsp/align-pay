"use client";
import type { AuditReport } from "@align-agent/paypal-guard";
import { useEffect, useState } from "react";
import { time } from "./useAppState";

const CLASS_LABEL: Record<string, string> = {
  traced: "traced",
  untraced: "untraced",
  incoming: "incoming",
  webhook_verified: "traced · awaiting listing",
  awaiting: "traced · awaiting listing",
  other: "other",
};

export function AuditView() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTests, setShowTests] = useState(false);
  useEffect(() => {
    void fetch("/api/audit", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setReport(j as AuditReport | null));
  }, []);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/audit", { method: "POST" });
      const j = (await r.json()) as AuditReport & { error?: string };
      if (!r.ok) setError(j.error ?? "The audit failed");
      else setReport(j);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button className="btn" onClick={run} disabled={busy} data-testid="run-audit">
          {busy ? "Reading PayPal…" : "Run audit now"}
        </button>
        {report ? <span className="small muted">Last run {time(report.ranAt)} · {report.rows.length} rows</span> : null}
      </div>
      <p className="notice small">
        PayPal&apos;s Transaction Search lists a transaction up to three hours after it happens. Newer refunds that PayPal&apos;s
        webhook has already confirmed show as <em>webhook verified, awaiting PayPal&apos;s listing</em>.
      </p>
      {report?.transactionSearchNote ? <p className="notice warn small">{report.transactionSearchNote}</p> : null}
      {error ? <p className="notice bad small">{error}</p> : null}
      {report ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
            {Object.entries(report.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <span key={k} className={`cls ${k}`}>
                  {n} {CLASS_LABEL[k]}
                </span>
              ))}
          </div>
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table data-testid="audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Class</th>
                  <th>Trace</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.filter((r) => showTests || r.cls !== "other").map((r) => (
                  <tr key={`${r.source}-${r.id}`} className={r.cls} data-testid={`audit-row-${r.cls}`} data-id={r.id}>
                    <td className="small">{time(r.at)}</td>
                    <td>
                      <div style={{ textTransform: "capitalize" }}>{r.kind}</div>
                      <div className="mono small muted">{r.id}</div>
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {r.amountUsd === null ? "—" : `${r.amountUsd < 0 ? "−" : ""}$${Math.abs(r.amountUsd).toFixed(2)}`}
                    </td>
                    <td>
                      <span className={`cls ${r.cls}`}>{CLASS_LABEL[r.cls]}</span>
                    </td>
                    <td className="small">
                      {r.label}
                      {r.note ? <div className="muted">{r.note}</div> : null}
                    </td>
                    <td className="small muted">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.counts.other ? (
            <p className="small muted">
              {report.counts.other} other rows are ALIGN Pay&apos;s own sandbox tests and setup checks, refunds made by other copies of
              ALIGN Pay on this sandbox account, or other PayPal activity.{" "}
              <button className="btn ghost small" onClick={() => setShowTests(!showTests)}>
                {showTests ? "Hide them" : "Show them"}
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted">No audit yet. Run one.</p>
      )}
    </section>
  );
}
