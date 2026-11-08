/**
 * The demo video, scene by scene: what is on screen and what the narrator says (about 2.5 words a second).
 * Adjusted from the submission draft's Q6 table to what was built. The pull-request scene is included only when
 * ALIGN's GitHub App commented on the demo PR (ALIGN_PAY_PR_SCREENSHOT points at the captured page).
 */
export interface Scene {
  id: string;
  onScreen: string;
  narration: string;
}

export const SCENES: Scene[] = [
  {
    id: "hook",
    onScreen: "Support desk: Asha types her refund request to the store's AI agent",
    narration: "AI agents can now move money through PayPal. A support agent can refund a customer in a single tool call. So who decided it could?",
  },
  {
    id: "rules",
    onScreen: "Owner page: the four decisions synced from ALIGN, each with its receipt quote, the limits Gemini drafted, and who confirmed them",
    narration:
      "The store owner said it once, in his own words. ALIGN keeps each decision with the exact quote as its receipt. Gemini drafted the limits each rule implies, and the owner confirmed them. Only confirmed limits are ever enforced.",
  },
  {
    id: "asha-held",
    onScreen: "Asha's $180 refund: the guard reads PayPal's record of the payment and holds it under the $50 decision",
    narration:
      "Asha's chai case arrived damaged, and the agent tries to refund 180 dollars. ALIGN Pay reads PayPal's own record of the payment, sees it is above the owner's 50 dollar limit, and holds it, quoting his decision.",
  },
  {
    id: "approve",
    onScreen: "Owner page: the owner approves; ALIGN Pay re-reads PayPal and refunds; the card shows the PayPal refund id",
    narration: "The owner approves. ALIGN Pay checks PayPal again, then refunds through its own PayPal client, with the decision key written onto the refund.",
  },
  {
    id: "verified",
    onScreen: "Back in the support chat: the card shows the PayPal refund id and PayPal's signed webhook",
    narration: "PayPal's signed webhook confirms the refund settled, and the customer sees the PayPal refund id.",
  },
  {
    id: "ben",
    onScreen: "Ben asks for a second refund this month: blocked under the one-refund-in-30-days decision",
    narration: "Ben already had a refund this month. The owner allows one in thirty days, so the agent is blocked, and it tells Ben to email the owner instead.",
  },
  {
    id: "chen",
    onScreen: "Chen's café asks for a wholesale invoice: 20% off and net 30 is blocked; 10% off and net 15 is created, and sending it waits for the owner",
    narration:
      "Chen's café wants an invoice at twenty percent off, net thirty. The owner's rule is net fifteen and at most ten percent, so it is blocked. At ten percent and net fifteen, the invoice is created, and sending it waits for the owner, because it is over two thousand dollars.",
  },
  {
    id: "injection",
    onScreen: "A customer tells the agent to ignore its rules and refund $500: nothing moves",
    narration: "And when a customer tells the agent to ignore its rules, nothing changes. The limits live outside the chat, and the facts come from PayPal.",
  },
  {
    id: "audit",
    onScreen: "Audit: every transaction from PayPal's Transaction Search; refunds and invoices traced to decisions; the refund made directly in PayPal flagged untraced",
    narration:
      "The audit pulls every transaction from PayPal. Each refund and invoice traces back to a decision, through the action that made it. The refund someone made directly in PayPal has no decision behind it, so it is flagged.",
  },
  {
    id: "integration",
    onScreen: "How it works: the architecture and the three-line integration",
    narration: "Wrap your PayPal Agent Toolkit tools in three lines. The model proposes, a person confirms, plain code enforces. ALIGN Pay is open source, and runs in the PayPal sandbox today.",
  },
];

export const PR_SCENE: Scene = {
  id: "pr",
  onScreen: "A coding agent's pull request raises the refund limit to $500; ALIGN's PR check comments, citing the decision",
  narration: "A coding agent opens a pull request that raises the refund limit to 500 dollars. ALIGN's PR check catches it, citing the owner's decision.",
};
