import { type Policy, describeLimits, receiptCard } from "@align-agent/paypal-guard";
import { runtime } from "./runtime";
import { currentScenario } from "./scenario";

export interface LedgerBadge {
  mode: "align" | "fixtures" | "none";
  label: string;
  syncedAt: string | null;
  stale: boolean;
  syncing: boolean;
  note: string | null;
}

export function ledgerBadge(): LedgerBadge {
  const rt = runtime();
  const snap = rt.store.getLedgerSnapshot();
  if (!snap) {
    return {
      mode: "none",
      label: rt.ledger.syncing ? "Ledger: connecting…" : "Ledger: none (everything is held)",
      syncedAt: null,
      stale: false,
      syncing: rt.ledger.syncing,
      note: rt.ledger.reason,
    };
  }
  return {
    mode: snap.mode,
    label: snap.mode === "align" ? "Ledger: ALIGN" : "Ledger: local fixtures (not ALIGN)",
    syncedAt: snap.syncedAt,
    stale: !!snap.stale,
    syncing: rt.ledger.syncing,
    note: snap.note ?? rt.ledger.reason,
  };
}

export interface PolicyView extends Policy {
  plain: string[];
  mismatch: boolean;
}

export function policyViews(): PolicyView[] {
  const rt = runtime();
  const snap = rt.store.getLedgerSnapshot();
  const keys = new Set(snap?.decisions.map((d) => d.key) ?? []);
  return rt.store
    .listPolicies()
    .filter((p) => keys.has(p.decisionKey))
    .map((p) => ({ ...p, plain: p.limits ? describeLimits(p.limits) : [], mismatch: rt.ledger.mismatches.includes(p.decisionKey) }));
}

export function cards(filter: Parameters<ReturnType<typeof runtime>["store"]["listActions"]>[0] = {}) {
  const rt = runtime();
  const policies = rt.store.listPolicies();
  return rt.store.listActions(filter).map((a) => receiptCard(a, policies));
}

export function card(id: string) {
  const rt = runtime();
  const a = rt.store.getAction(id);
  return a ? receiptCard(a, rt.store.listPolicies()) : null;
}

export function appState() {
  const rt = runtime();
  const s = currentScenario();
  return {
    ledger: ledgerBadge(),
    policies: policyViews(),
    holds: rt.store.listActions({ status: "held" }).length,
    scenario: s,
    customers: s
      ? Object.entries(s.customers).map(([base, id]) => {
          const c = rt.directory.customer(id)!;
          return { base, id, name: c.name, businessName: c.businessName, orders: rt.store.listOrders({ customerId: id }) };
        })
      : [],
    models: { agent: rt.pro ? (process.env.GEMINI_PRO_MODEL ?? "gemini-2.5-pro") : null },
    confirmationsFile: !!rt.confirmations,
  };
}
export type AppState = ReturnType<typeof appState>;
