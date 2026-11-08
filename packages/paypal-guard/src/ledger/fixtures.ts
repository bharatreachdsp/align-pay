import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Ledger, LedgerSnapshot } from "./types";

const FixturesFile = z.object({
  note: z.string().optional(),
  decisions: z
    .array(
      z.object({
        key: z.string().regex(/^LOCAL-\d+$/),
        statement: z.string().min(12),
        why: z.string().nullable().optional(),
        revision: z.number().int().min(1).default(1),
        receipts: z.array(z.object({ quote: z.string(), source: z.string() })).min(1),
      }),
    )
    .min(1),
});

/** `ledger/fixtures.json`: decisions mirroring the store's rules for anyone running without ALIGN. */
export class FixturesLedger implements Ledger {
  readonly mode = "fixtures" as const;
  constructor(private readonly file: string) {}

  async sync(): Promise<LedgerSnapshot> {
    const parsed = FixturesFile.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ this.file, "utf8")));
    return {
      mode: "fixtures",
      syncedAt: new Date().toISOString(),
      source: "ledger/fixtures.json (local fixtures, not ALIGN)",
      decisions: parsed.decisions.map((d) => ({
        key: d.key,
        statement: d.statement,
        status: "confirmed",
        revision: d.revision,
        why: d.why ?? null,
        receipts: d.receipts.map((r) => ({ quote: r.quote, source: r.source })),
        confirmedBy: "local fixture",
        confirmedAt: null,
      })),
    };
  }
}
