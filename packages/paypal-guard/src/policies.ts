import type { Drafter } from "./drafting";
import type { PolicySource } from "./guard";
import type { LedgerDecision, LedgerSnapshot } from "./ledger/types";
import type { Logger } from "./paypal/client";
import { silentLogger } from "./paypal/client";
import {
  type ConfirmedLimitsFile,
  type Limits,
  LimitsSchema,
  type Policy,
  findConfirmation,
  limitsEqual,
  normaliseStatement,
} from "./policy";
import type { Store } from "./store/types";

export const SETUP_CONFIRMER = "Store owner, during setup";

export interface SyncReport {
  policies: Policy[];
  /** Decisions whose draft still differs from the owner's confirmation after a re-draft: a stop condition. */
  mismatches: string[];
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
 * - A new decision, or one whose statement or revision changed, is drafted (again) and starts as a draft.
 * - A draft equal to the limits the owner confirmed during setup (same statement) is confirmed: "Store owner, during
 *   setup". If it differs, it is re-drafted once with those limits as a hint; if it still differs, it stays a draft.
 * - Nothing here confirms anything else: the owner page does that, marked with who did it.
 */
export async function syncPolicies(a: {
  snapshot: LedgerSnapshot;
  store: Store;
  drafter: Drafter | null;
  confirmations: ConfirmedLimitsFile | null;
  now?: () => Date;
  log?: Logger;
}): Promise<SyncReport> {
  const now = a.now ?? (() => new Date());
  const log = a.log ?? silentLogger;
  const mismatches: string[] = [];
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
    }

    const conf = findConfirmation(a.confirmations, d.statement);

    if (!p.limits) {
      if (!a.drafter) {
        p.note = "No model is configured to draft limits (set GOOGLE_GENERATIVE_AI_API_KEY), so this stays a draft.";
      } else {
        try {
          const dr = await a.drafter.draft({ statement: d.statement, receipts: d.receipts });
          p.limits = dr.limits;
          p.reading = dr.reading;
          p.draftedBy = dr.model;
          p.draftedAt = now().toISOString();
          if (conf && !limitsEqual(dr.limits, conf.limits)) {
            log.warn("draft differs from the owner's confirmation; re-drafting with a hint", { decision: d.key });
            const again = await a.drafter.draft({ statement: d.statement, receipts: d.receipts, hint: conf.limits });
            p.limits = again.limits;
            p.reading = again.reading;
            p.draftedAt = now().toISOString();
          }
        } catch (e) {
          p.note = `Drafting failed: ${(e as Error).message.slice(0, 200)}. Use Sync again to retry.`;
          log.warn("drafting failed", { decision: d.key, error: (e as Error).message.slice(0, 200) });
        }
      }
    }

    if (p.status === "draft" && p.limits && conf) {
      if (limitsEqual(p.limits, conf.limits)) {
        p.status = "confirmed";
        p.confirmedBy = SETUP_CONFIRMER;
        p.confirmedAt = a.confirmations!.confirmedAt;
        p.confirmMethod = "setup";
        p.note = null;
      } else {
        p.note = "The drafted limits differ from what the owner confirmed during setup, so they are not enforced.";
        mismatches.push(d.key);
      }
    }
    a.store.putPolicy(p);
    out.push(p);
  }
  return { policies: out, mismatches };
}

/** A person confirms a policy on the owner page, optionally with edited numbers. */
export function confirmPolicy(
  store: Store,
  key: string,
  limits: unknown,
  by: "local user" | "store owner",
  now: Date = new Date(),
): Policy {
  const p = store.getPolicy(key);
  if (!p) throw new Error("No such policy");
  const parsed: Limits = LimitsSchema.parse(limits);
  const edited = !p.limits || !limitsEqual(parsed, p.limits);
  const next: Policy = {
    ...p,
    limits: parsed,
    status: "confirmed",
    confirmedBy: by,
    confirmedAt: now.toISOString(),
    confirmMethod: "owner page",
    note: edited ? `Numbers edited on the owner page by the ${by}.` : null,
  };
  store.putPolicy(next);
  return next;
}

/** The policy source the guard reads: confirmed policies of the current snapshot only. */
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
