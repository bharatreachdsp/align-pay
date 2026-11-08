import type { Receipt } from "../policy";

/** "sample": the Sample ALIGN ledger in the repository (default). "align": a live ALIGN workspace through align mcp. */
export type LedgerMode = "sample" | "align";

/** One confirmed decision, as the ledger serves it. The receipts are the exact quotes it came from. */
export interface LedgerDecision {
  key: string;
  statement: string;
  status: string;
  revision: number | null;
  why: string | null;
  receipts: Receipt[];
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface LedgerSnapshot {
  mode: LedgerMode;
  syncedAt: string;
  decisions: LedgerDecision[];
  /** Plain words about where this came from, for the badge. */
  source: string;
  /** Served from the cache because the ledger did not answer. */
  stale?: boolean;
  note?: string;
}

export interface Ledger {
  readonly mode: LedgerMode;
  sync(): Promise<LedgerSnapshot>;
}

/** The four store rules, as the owner stated them. Decisions are matched to these by statement. */
export const STORE_RULE_STATEMENTS = [
  "The support agent may refund up to $50 per order on its own. Any refund above $50 needs my approval first.",
  "A customer gets at most one refund in any 30 days. The agent must refuse a second refund within 30 days; the customer can email me instead.",
  "Never refund an order that has an open PayPal dispute. Answer the dispute instead.",
  "Wholesale invoices use net 15 terms with at most a 10% discount, and any invoice over $2,000 needs my approval before it is sent.",
] as const;
