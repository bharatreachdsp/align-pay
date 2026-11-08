import type { Logger } from "../paypal/client";
import type { Store } from "../store/types";
import type { Ledger, LedgerSnapshot } from "./types";

export type LedgerPreference = "sample" | "align";

export interface LedgerState {
  snapshot: LedgerSnapshot | null;
  /** Why there is no snapshot, or why it is stale. */
  reason: string | null;
}

/**
 * Picks the ledger and keeps the last good snapshot in the store.
 *
 * - sample (default): the Sample ALIGN ledger in the repository.
 * - align: a live ALIGN workspace through align mcp; if it does not answer, the cached copy of it; else nothing
 *   (everything is held, and the badge says why). It never falls back to the sample.
 */
export async function syncLedger(a: {
  preference: LedgerPreference;
  align: Ledger | null;
  sample: Ledger;
  store: Store;
  log: Logger;
}): Promise<LedgerState> {
  const cached = a.store.getLedgerSnapshot();
  if (a.preference === "align") {
    if (!a.align) return { snapshot: null, reason: "No ALIGN client is configured" };
    try {
      const snap = await a.align.sync();
      if (snap.decisions.length > 0) {
        a.store.putLedgerSnapshot(snap);
        return { snapshot: snap, reason: null };
      }
      a.log.warn("ALIGN answered, but none of the store's rules are recorded there as confirmed decisions");
      // The decisions are gone from ALIGN (revoked or never recorded): the old copy must not keep allowing things.
      a.store.clearLedgerSnapshot();
      return { snapshot: null, reason: "ALIGN answered, but the store's rules are not recorded there" };
    } catch (e) {
      const why = (e as Error).message.slice(0, 200);
      a.log.warn("ALIGN did not answer", { why });
      if (cached && cached.mode === "align") {
        const stale = { ...cached, stale: true, note: `ALIGN did not answer (${why}); serving the copy synced ${cached.syncedAt}.` };
        return { snapshot: stale, reason: stale.note };
      }
      if (cached) a.store.clearLedgerSnapshot();
      return { snapshot: null, reason: `ALIGN did not answer (${why}) and there is no cached copy` };
    }
  }
  try {
    const snap = await a.sample.sync();
    a.store.putLedgerSnapshot(snap);
    return { snapshot: snap, reason: null };
  } catch (e) {
    a.store.clearLedgerSnapshot();
    return { snapshot: null, reason: `The sample ledger could not be read: ${(e as Error).message.slice(0, 160)}` };
  }
}
