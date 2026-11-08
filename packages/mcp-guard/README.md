# ALIGN Pay MCP proxy

An MCP server that sits in front of PayPal's own MCP server (`@paypal/mcp`, sandbox), so a coding agent such as
Claude Code or Cursor gets PayPal's tools with the same guard as the support agent:

- `tools/list` returns PayPal's tools, minus the money-moving ones the guard does not cover (`pay_order`,
  `accept_dispute_claim`, subscriptions, …).
- Read tools (`get_order`, `list_invoices`, …) are forwarded to PayPal's server.
- `create_refund`, `create_invoice`, `send_invoice` and `cancel_sent_invoice` go through the guard: the confirmed
  limits, PayPal's own facts, block > hold > allow. A coding agent acts for no customer, so its refunds and invoices
  are held for the owner (rules that block still block); the hold appears on the app's owner page, because the proxy
  uses the app's local store (`.data/`). The result is `{status, decision_key, reason, paypal_id?, action_id}`.
- A tool the guard does not know is held.

It reads the repository's `.env` (sandbox keys) and the policies the app has synced, so run `pnpm demo` once first.
The proxy requests its own short-lived sandbox access token for PayPal's server.

## Claude Code

```sh
claude mcp add paypal-guarded -- /path/to/align-pay/node_modules/.bin/tsx /path/to/align-pay/packages/mcp-guard/src/server.ts
```

## Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "paypal-guarded": {
      "command": "/path/to/align-pay/node_modules/.bin/tsx",
      "args": ["/path/to/align-pay/packages/mcp-guard/src/server.ts"]
    }
  }
}
```

Check it with `tsx scripts/mcp-check.ts`: it lists the tools, reads an order through PayPal's server, and asks for
a $1 refund through the guard.
