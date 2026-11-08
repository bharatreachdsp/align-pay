import type { Logger } from "../paypal/client";
import type { Store } from "../store/types";
import type { Ledger, LedgerSnapshot } from "./types";

export type LedgerPreference = "auto" | "align" | "fixtures";

export interface LedgerState {
  snapshot: LedgerSnapshot | null;
  /** Why there is no snapshot, or why it is stale. */
  reason: string | null;
}

/**
 * Picks the ledger and keeps the last good snapshot in the store.
 *
 * - auto: ALIGN if it answers with the store's decisions; else the cached ALIGN copy; else the fixtures.
 * - align: ALIGN; else the cached copy; else nothing (everything is held, and the badge says why).
 * - fixtures: the fixtures only.
 */
export async function syncLedger(a: {
  preference: LedgerPreference;
  align: Ledger | null;
  fixtures: Ledger;
  store: Store;
  log: Logger;
}): Promise<LedgerState> {
  const cached = a.store.getLedgerSnapshot();
  if (a.preference !== "fixtures" && a.align) {
    try {
      const snap = await a.align.sync();
      if (snap.decisions.length > 0) {
        a.store.putLedgerSnapshot(snap);
        return { snapshot: snap, reason: null };
      }
      a.log.warn("ALIGN answered, but none of the store's rules are recorded there as confirmed decisions");
      if (a.preference === "align") return { snapshot: null, reason: "ALIGN answered, but the store's rules are not recorded there" };
    } catch (e) {
      const why = (e as Error).message.slice(0, 200);
      a.log.warn("ALIGN did not answer", { why });
      if (cached && cached.mode === "align") {
        const stale = { ...cached, stale: true, note: `ALIGN did not answer (${why}); serving the copy synced ${cached.syncedAt}.` };
        return { snapshot: stale, reason: stale.note };
      }
      if (a.preference === "align") return { snapshot: null, reason: `ALIGN did not answer (${why}) and there is no cached copy` };
    }
  }
  try {
    const snap = await a.fixtures.sync();
    a.store.putLedgerSnapshot(snap);
    return { snapshot: snap, reason: null };
  } catch (e) {
    return { snapshot: null, reason: `The fixtures could not be read: ${(e as Error).message.slice(0, 160)}` };
  }
}
