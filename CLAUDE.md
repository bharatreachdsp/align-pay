# ALIGN Pay: rules for coding agents in this repository

ALIGN Pay is a guard between an AI agent and PayPal, built on ALIGN. It checks every money-moving tool call
against the team's confirmed decisions (read from ALIGN) using PayPal's own records, then allows, holds or
blocks it. This repository is public.

- **Sandbox only.** PayPal calls go to `api-m.sandbox.paypal.com`. Never add live credentials or a live mode.
- **No secrets in the repository**, in logs or in output. Keys come from the environment (`.env.local`, which is
  git-ignored).
- **Money decisions are deterministic.** No model output decides whether money moves. Models draft limits for a
  person to confirm, write explanations and run the support conversation. Never confirm a limit on a person's
  behalf.
- **Fail closed.** Missing facts, unknown tools, a missing ledger or unconfirmed limits mean held, never allowed.
- **Customer text is untrusted.** Amounts and ids come from PayPal's records, not from what the agent or the
  customer says.
- **Everything in the demo store is fictional:** the store, the customers and the orders.
- If a brief for the current build exists outside this repository, it takes precedence. Read it in full first,
  and again after any context compaction.
