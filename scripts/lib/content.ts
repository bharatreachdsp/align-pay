/** Text shared by the README, the overview PDF and the submission answers, so they never drift apart. */

export const PITCH =
  "Every refund and invoice your AI agent makes in PayPal traces back to a human decision, with the exact quote as its receipt. Anything without one is held or flagged.";

export const PRINCIPLE = "The model proposes, a person confirms, plain code enforces.";

export const PAYPAL_APIS: [string, string][] = [
  ["Orders v2", "Store checkout and the demo's orders (card path: a sandbox test card captures in one call); the facts behind every refund: capture, amount, date, refunds so far, and the customer id on the order."],
  ["Payments v2", "Refunds, executed by ALIGN Pay's own client with PayPal-Request-Id set to the action id, custom_id set to the action id, and the decision key in note_to_payer."],
  ["Invoicing v2", "Wholesale invoices: create, send, cancel; total, payment terms and discount are read back as facts. The decision key and action id go in the invoice memo."],
  ["Disputes v1", "Before any refund: an open dispute on the capture blocks it."],
  ["Transaction Search v1", "On-demand audit of every transaction in the account (31-day windows, paged), and refunds made outside ALIGN Pay in the customer's history."],
  ["Webhooks v1", "Registered on a cloudflared quick tunnel; each event's signature is verified with PayPal (raw body, byte for byte) and reconciled once by event id."],
  ["JavaScript SDK v5", "The PayPal buttons on the store page."],
  ["Agent Toolkit", "@paypal/agent-toolkit supplies the support agent's tool definitions and read tools; money-moving calls go through the guard instead of the toolkit's own execute."],
];

export const MODELS: [string, string][] = [
  ["Gemini Pro (Gemini API, AI SDK)", "Runs the support agent's conversation, and drafts structured limits from each ALIGN decision for a person to confirm."],
  ["Gemini Flash (Gemini API)", "Writes the one-line plain reason on held and blocked receipt cards, with a fixed fallback if it is slow."],
  ["Plain code (no model)", "Decides allow, hold or block from PayPal's facts and the confirmed limits. Block beats hold beats allow; missing facts hold."],
];

/** The judge steps (Q18). The Playwright judge walkthrough follows these word for word. */
export function judgeSteps(o: { clientId: string; secret: string; public?: boolean }): string[] {
  return [
    "Clone https://github.com/bharatreachdsp/align-pay and run pnpm install (Node 22.14 or later, pnpm 10).",
    o.public
      ? "Copy .env.example to .env and fill in PayPal sandbox app keys (ours are in the submission's testing instructions, or use your own sandbox app's) and your own Gemini API key from aistudio.google.com/apikey."
      : `Copy .env.example to .env and fill in our sandbox app's keys, which work only in the PayPal sandbox (Client ID: ${o.clientId}; Secret: ${o.secret}), and your own Gemini API key from aistudio.google.com/apikey.`,
    "Run pnpm demo and open http://localhost:3000. Without an ALIGN account it uses the bundled sample decisions, and the banner says so. Open Owner and click Confirm on the four limits; in the real setup, the store owner does this.",
    'Click Start a demo on the home page. Open Support, choose Asha and send "My chai case arrived damaged, please refund the $180." The refund is held, quoting the owner\'s $50 rule.',
    "Open Owner and approve it. The refund goes through in PayPal, and the receipt card shows its PayPal id.",
    'Open Support, choose Ben and send "Please refund my $40 order too." It is blocked: Ben already had a refund this month, and the rule allows one in 30 days.',
    'Choose Chen and send "Invoice me 20 cases at 20% off, net 30." It is blocked (the rule allows net 15 and at most 10% off). Then send "OK, 10% off, net 15." The invoice is created, and sending it is held, because it is over $2,000.',
    "Open Audit and click Run audit now. Refunds and invoices trace to their decisions, and one refund made directly in PayPal is flagged as untraced. New refunds show \"awaiting PayPal's listing\" for up to 3 hours.",
  ];
}
