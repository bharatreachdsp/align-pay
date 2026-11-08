import { type AuditReport, PayPalError, classifyAudit, listInvoices, searchTransactions } from "@align-agent/paypal-guard";
import { runtime } from "./runtime";

/** Runs the audit now: Transaction Search for the last 31 days, the Invoicing list, and ALIGN Pay's own records. */
export async function runAudit(): Promise<AuditReport> {
  const rt = runtime();
  const now = new Date();
  let transactions = null;
  let transactionsError: string | null = null;
  try {
    transactions = await searchTransactions(rt.paypal, new Date(now.getTime() - 31 * 86_400_000), now);
  } catch (e) {
    transactionsError =
      e instanceof PayPalError && e.notAuthorized
        ? "Transaction Search is not active for this PayPal app yet (403). The audit uses webhooks and ALIGN Pay's records meanwhile."
        : `Transaction Search did not answer: ${(e as Error).message.slice(0, 160)}`;
  }
  let invoices = null;
  try {
    invoices = await listInvoices(rt.paypal);
  } catch (e) {
    rt.log.warn("invoice list failed", { error: (e as Error).message.slice(0, 160) });
  }
  const report = classifyAudit({
    transactions,
    transactionsError,
    invoices,
    actions: rt.store.listActions(),
    orders: rt.store.listOrders(),
    webhookEvents: rt.store.listWebhookEvents(),
    now,
  });
  rt.store.setKv("last_audit", report);
  return report;
}

export function lastAudit(): AuditReport | null {
  return runtime().store.getKv<AuditReport>("last_audit");
}
