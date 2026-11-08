/**
 * `tsx scripts/mcp-check.ts`: connects to the MCP proxy (packages/mcp-guard) like a coding agent would, lists its
 * tools, reads an order through PayPal's MCP server, and asks for a $1 refund on a seed order through the guard.
 */
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { sqliteStore } from "@align-agent/paypal-guard/store/sqlite";
import { DB_FILE, REPO_ROOT, loadEnv } from "./lib/env";

loadEnv();
const seed = sqliteStore(DB_FILE).getKv<{ orders: { orderId: string; captureId: string }[] }>("seed");
if (!seed) throw new Error("Run pnpm seed first.");
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(PAYPAL_CLIENT|GOOGLE_|PAYPAL_SANDBOX)/.test(k)) env[k] = v;
const client = new Client({ name: "mcp-check", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({
    command: join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    args: [join(REPO_ROOT, "packages", "mcp-guard", "src", "server.ts")],
    cwd: REPO_ROOT,
    env,
    stderr: "inherit",
  }),
);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log(`tools: ${names.length}; pay_order exposed: ${names.includes("pay_order")}; accept_dispute_claim exposed: ${names.includes("accept_dispute_claim")}; create_refund exposed: ${names.includes("create_refund")}`);
const order = seed.orders[0]!;
const read = (await client.callTool({ name: "get_order", arguments: { id: order.orderId } })) as { content: { text: string }[]; isError?: boolean };
console.log(`get_order through PayPal's MCP server: ${read.isError ? "error" : "ok"} (${read.content[0]?.text.includes(order.orderId) ? "order found" : read.content[0]?.text.slice(0, 120)})`);
const refund = (await client.callTool({ name: "create_refund", arguments: { capture_id: order.captureId, amount: { value: "1.00", currency_code: "USD" } } })) as { structuredContent?: Record<string, unknown> };
console.log(`create_refund through the guard: ${JSON.stringify(refund.structuredContent)}`);
const blocked = (await client.callTool({ name: "pay_order", arguments: { id: order.orderId } })) as { isError?: boolean; content: { text: string }[] };
console.log(`pay_order: ${blocked.isError ? "refused" : "ran"} (${blocked.content[0]?.text.slice(0, 100)})`);
await client.close();
