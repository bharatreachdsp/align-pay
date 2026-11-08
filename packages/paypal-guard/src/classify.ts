import type { ActionType } from "./actions";

/**
 * Every tool the support agent could be given, and what the guard does with it. Built from an inventory of
 * @paypal/agent-toolkit 1.11.0 (49 tools) plus ALIGN Pay's own tools.
 *
 * - read:        passes through to PayPal and is logged.
 * - guarded:     becomes an Action and goes through the guard.
 * - not_exposed: removed from the agent's toolset.
 *
 * A tool that is not in this table is treated as money-moving: it stays callable, but every call is held for the
 * owner, and a warning is logged when the toolset is built.
 */
export type ToolClass = { class: "read" } | { class: "guarded"; action: ActionType } | { class: "not_exposed"; why: string };

const read = { class: "read" } as const;
const guarded = (action: ActionType): ToolClass => ({ class: "guarded", action });
const hidden = (why: string): ToolClass => ({ class: "not_exposed", why });

export const TOOL_TABLE: Readonly<Record<string, ToolClass>> = {
  // ALIGN Pay's own tools
  refund_order: guarded("refund.create"),
  list_customer_orders: read,

  // Orders
  get_order: read,
  create_order: hidden("creates a payment request; the store creates orders itself"),
  pay_order: hidden("captures money; not guarded, so never exposed"),

  // Payments
  create_refund: guarded("refund.create"),
  get_refund: read,

  // Invoicing
  create_invoice: guarded("invoice.create"),
  send_invoice: guarded("invoice.send"),
  cancel_sent_invoice: guarded("invoice.cancel"),
  list_invoices: read,
  get_invoice: read,
  search_invoicing: read,
  generate_invoice_number: read,
  generate_invoice_qr_code: hidden("a payment code for an invoice; not needed by support"),
  send_invoice_reminder: hidden("contacts the customer about money owed; not guarded"),
  delete_invoice: hidden("deletes an invoice; not guarded"),
  update_invoicing: hidden("changes an invoice's amounts or terms; not guarded"),
  record_payment_for_invoice: hidden("marks money as received; not guarded"),
  record_refund_for_invoice: hidden("marks money as refunded; not guarded"),
  create_conditional_rules_for_invoice: hidden("changes invoice behaviour; not guarded"),
  setup_invoice_auto_reminders: hidden("account-wide reminder settings; not guarded"),
  update_invoice_auto_reminder: hidden("account-wide reminder settings; not guarded"),
  cancel_invoice_auto_reminder: hidden("changes invoice reminders; not guarded"),
  create_recurring_series: hidden("bills a customer repeatedly; not guarded"),
  activate_recurring_series: hidden("starts repeated billing; not guarded"),
  get_recurring_series: read,
  cancel_recurring_series: hidden("changes repeated billing; not guarded"),
  delete_recurring_series: hidden("changes repeated billing; not guarded"),

  // Disputes
  list_disputes: read,
  get_dispute: read,
  accept_dispute_claim: hidden("concedes a dispute and returns money; not guarded"),

  // Subscriptions and catalogue
  create_subscription: hidden("bills a customer repeatedly; not guarded"),
  cancel_subscription: hidden("changes billing; not guarded"),
  update_subscription: hidden("changes billing amounts; not guarded"),
  show_subscription_details: read,
  create_subscription_plan: hidden("creates a billing plan; not guarded"),
  update_plan: hidden("changes billing amounts; not guarded"),
  list_subscription_plans: read,
  show_subscription_plan_details: read,
  create_product: hidden("changes the catalogue; not needed by support"),
  update_product: hidden("changes the catalogue; not needed by support"),
  list_products: read,
  show_product_details: read,

  // Shipping, reporting
  create_shipment_tracking: hidden("changes order records; not needed by support"),
  update_shipment_tracking: hidden("changes order records; not needed by support"),
  get_shipment_tracking: read,
  list_transactions: read,
  get_merchant_insights: read,
};

/** Unknown tools are money-moving until proven otherwise. */
export function classifyTool(name: string): ToolClass | { class: "unknown" } {
  return Object.hasOwn(TOOL_TABLE, name) ? (TOOL_TABLE[name] as ToolClass) : { class: "unknown" };
}

/** The toolkit configuration ALIGN Pay gives its support agent: the read tools it needs plus the guarded ones. */
export const SUPPORT_AGENT_TOOLKIT_ACTIONS = {
  orders: { get: true },
  invoices: { create: true, get: true, send: true, cancel: true },
} as const;
