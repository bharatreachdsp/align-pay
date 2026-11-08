import { readFileSync } from "node:fs";
import { z } from "zod";
import { Entry } from "./align-schema";
import type { Ledger, LedgerSnapshot } from "./types";

export const SAMPLE_LEDGER_LABEL = "Sample ALIGN ledger";

const SampleFile = z.object({
  about: z.string().optional(),
  workspace: z.string().optional(),
  entries: z.array(Entry).min(1),
});

/**
 * `ledger/sample-ledger.json`: the store's decisions as ALIGN entries, validated against ALIGN's own ledger schema.
 * It is the default ledger. It is a sample shipped with the repository, not a live ALIGN workspace, and the UI says so.
 */
export class SampleLedger implements Ledger {
  readonly mode = "sample" as const;
  constructor(private readonly file: string) {}

  async sync(): Promise<LedgerSnapshot> {
    const parsed = SampleFile.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ this.file, "utf8")));
    return {
      mode: "sample",
      syncedAt: new Date().toISOString(),
      source: `${SAMPLE_LEDGER_LABEL} (ledger/sample-ledger.json)`,
      decisions: parsed.entries
        .filter((e) => e.kind === "decision" && e.status === "confirmed")
        .map((e) => ({
          key: e.key,
          statement: e.statement,
          status: e.status,
          revision: e.revision,
          why: e.rationale,
          receipts: e.evidence.map((ev) => ({ quote: ev.quote, source: `${SAMPLE_LEDGER_LABEL} · ${ev.kind}`, at: ev.created_at, url: ev.url })),
          confirmedBy: e.confirmed_by?.display_name ?? null,
          confirmedAt: e.confirmed_at ?? null,
        })),
    };
  }
}
