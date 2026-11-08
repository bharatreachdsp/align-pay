"use client";
import { time, useAppState } from "./useAppState";

/** Which ledger is on, and when it last synced. On every page. */
export function LedgerBadge() {
  const { state } = useAppState(5000);
  const l = state?.ledger;
  if (!l) return <span className="badge">Ledger: …</span>;
  return (
    <span className={`badge ${l.mode}`} title={l.note ?? undefined} data-testid="ledger-badge">
      <span className="dot" />
      {l.label}
      {l.syncedAt ? <span className="muted">· synced {time(l.syncedAt)}{l.stale ? " (cached)" : ""}</span> : null}
      {l.syncing ? <span className="muted">· syncing</span> : null}
    </span>
  );
}
