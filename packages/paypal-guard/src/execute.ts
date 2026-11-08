import type { Verdict } from "./engine";
import type { Facts } from "./facts";
import type { PayPalClient } from "./paypal/client";
import { cancelInvoice, createInvoice, getInvoice, invoicePayload, sendInvoice } from "./paypal/invoices";
import { refundCapture } from "./paypal/refunds";
import type { ActionRecord } from "./store/types";

export interface ExecResult {
  paypalId: string;
  paypalStatus: string;
  amountUsd?: number;
}

export interface Executor {
  execute(rec: ActionRecord, facts: Facts, verdict: Verdict): Promise<ExecResult>;
}

/**
 * Money moves only here, through ALIGN Pay's own PayPal client: every call carries `PayPal-Request-Id: <action id>`,
 * and the PayPal object is annotated with the decision key. Ids and amounts come from PayPal's facts, not the agent.
 */
export class PayPalExecutor implements Executor {
  constructor(
    private readonly pp: PayPalClient,
    private readonly storeName = "Kettle & Kesar",
  ) {}

  async execute(rec: ActionRecord, facts: Facts, verdict: Verdict): Promise<ExecResult> {
    const key = verdict.primaryKey ?? "unknown";
    switch (rec.type) {
      case "refund.create": {
        if (facts.kind !== "refund" || !facts.captureId || verdict.requestedUsd === null) throw new Error("refund facts missing");
        const r = await refundCapture(this.pp, {
          captureId: facts.captureId,
          amountUsd: verdict.requestedUsd,
          requestId: rec.id,
          customId: rec.id,
          // PayPal HTML-escapes "&" in note_to_payer ("&amp;"), so the note spells it out.
          noteToPayer: `Refund under ${this.storeName.replace(/&/g, "and")} policy ${key}${verdict.approved ? " (approved by the owner)" : ""}`,
        });
        return { paypalId: r.id, paypalStatus: r.status, amountUsd: verdict.requestedUsd };
      }
      case "invoice.create": {
        if (facts.kind !== "invoice" || !facts.draft) throw new Error("invoice facts missing");
        const inv = await createInvoice(
          this.pp,
          invoicePayload(facts.draft, `ALIGN ${key} · ${rec.id}`, new Date().toISOString().slice(0, 10)),
          rec.id,
        );
        return { paypalId: inv.id, paypalStatus: inv.status, amountUsd: facts.draft.totalUsd };
      }
      case "invoice.send": {
        if (facts.kind !== "invoice" || !facts.invoiceId) throw new Error("invoice facts missing");
        await sendInvoice(this.pp, facts.invoiceId, rec.id);
        const inv = await getInvoice(this.pp, facts.invoiceId);
        return { paypalId: facts.invoiceId, paypalStatus: inv.status, ...(facts.totalUsd !== null ? { amountUsd: facts.totalUsd } : {}) };
      }
      case "invoice.cancel": {
        if (facts.kind !== "invoice" || !facts.invoiceId) throw new Error("invoice facts missing");
        await cancelInvoice(this.pp, facts.invoiceId, rec.id);
        return { paypalId: facts.invoiceId, paypalStatus: "CANCELLED" };
      }
      default:
        throw new Error("ALIGN Pay cannot execute this tool");
    }
  }
}
