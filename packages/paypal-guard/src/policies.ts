import type { Drafter } from "./drafting";
import type { PolicySource } from "./guard";
import type { LedgerDecision, LedgerSnapshot } from "./ledger/types";
import type { Logger } from "./paypal/client";
import { silentLogger } from "./paypal/client";
import { type Limits, LimitsSchema, type Policy, limitsEqual, normaliseStatement } from "./policy";
import type { Store } from "./store/types";

/** Who a confirmation on the owner page is shown as. */
export const OWNER = "store owner";

export interface SyncReport {
  policies: Policy[];
}

function freshPolicy(d: LedgerDecision, mode: Policy["ledgerMode"]): Policy {
  return {
    decisionKey: d.key,
    statement: d.statement,
    decisionRevision: d.revision,
    receipts: d.receipts,
    ledgerMode: mode,
    status: "draft",
    limits: null,
    reading: null,
    draftedBy: null,
    draftedAt: null,
    confirmedBy: null,
    confirmedAt: null,
    confirmMethod: null,
    note: null,
  };
}

/**
 * Brings the policies in line with a ledger snapshot.
 *
 * - A new decision, or one whose statement or revision changed, is drafted (again) by the model and starts as a draft.
 * - A decision that did not change keeps its limits and its confirmation.
 * - Nothing here confirms anything: only the store owner's Confirm click on the owner page does (confirmPolicy).
 */
export async function syncPolicies(a: {
  snapshot: LedgerSnapshot;
  store: Store;
  drafter: Drafter | null;
  now?: () => Date;
  log?: Logger;
}): Promise<SyncReport> {
  const now = a.now ?? (() => new Date());
  const log = a.log ?? silentLogger;
  const out: Policy[] = [];

  for (const d of a.snapshot.decisions) {
    const prev = a.store.getPolicy(d.key);
    const same =
      prev &&
      normaliseStatement(prev.statement) === normaliseStatement(d.statement) &&
      prev.decisionRevision === d.revision &&
      prev.ledgerMode === a.snapshot.mode;
    let p: Policy;
    if (same && prev.limits) {
      p = { ...prev, receipts: d.receipts };
    } else {
      p = freshPolicy(d, a.snapshot.mode);
      if (prev && !same) {
        p.note = `The decision changed in the ledger (revision ${prev.decisionRevision ?? "?"} → ${d.revision ?? "?"}), so its limits went back to draft.`;
      }
      if (!a.drafter) {
        p.note = "No model is configured to draft limits (set GOOGLE_GENERATIVE_AI_API_KEY), so this stays a draft.";
      } else {
        try {
          const dr = await a.drafter.draft({ statement: d.statement, receipts: d.receipts });
          p.limits = dr.limits;
          p.reading = dr.reading;
          p.draftedBy = dr.model;
          p.draftedAt = now().toISOString();
        } catch (e) {
          p.note = `Drafting failed: ${(e as Error).message.slice(0, 200)}. Click "Sync with the ledger" to try again.`;
          log.warn("drafting failed", { decision: d.key, error: (e as Error).message.slice(0, 200) });
        }
      }
    }
    a.store.putPolicy(p);
    out.push(p);
  }
  return { policies: out };
}

/** The store owner clicks Confirm on the owner page, optionally after editing the numbers. */
export function confirmPolicy(store: Store, key: string, limits: unknown, now: Date = new Date()): Policy {
  const p = store.getPolicy(key);
  if (!p) throw new Error("No such policy");
  const parsed: Limits = LimitsSchema.parse(limits);
  const edited = !p.limits || !limitsEqual(parsed, p.limits);
  const next: Policy = {
    ...p,
    limits: parsed,
    status: "confirmed",
    confirmedBy: OWNER,
    confirmedAt: now.toISOString(),
    confirmMethod: "owner page",
    note: edited ? "The store owner edited the numbers before confirming." : null,
  };
  store.putPolicy(next);
  return next;
}

/** The store owner withdraws a confirmation: the limits go back to draft and are no longer enforced. */
export function withdrawPolicy(store: Store, key: string): Policy {
  const p = store.getPolicy(key);
  if (!p) throw new Error("No such policy");
  const next: Policy = {
    ...p,
    status: "draft",
    confirmedBy: null,
    confirmedAt: null,
    confirmMethod: null,
    note: "The store owner withdrew the confirmation; nothing is enforced until it is confirmed again.",
  };
  store.putPolicy(next);
  return next;
}

/** The policy source the guard reads: policies of the current snapshot only. */
export function storePolicySource(store: Store, reason: () => string | null): PolicySource {
  return {
    async current() {
      const snap = store.getLedgerSnapshot();
      if (!snap) return { ledger: { available: false, reason: reason() ?? "no ledger snapshot" }, policies: [] };
      const keys = new Set(snap.decisions.map((d) => d.key));
      return { ledger: { available: true }, policies: store.listPolicies().filter((p) => keys.has(p.decisionKey)) };
    },
  };
}
