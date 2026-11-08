/**
 * ALIGN Pay as an MCP proxy in front of PayPal's own MCP server (@paypal/mcp, sandbox).
 *
 * A coding agent (Claude Code, Cursor, any MCP client) connects to this server over stdio instead of to PayPal's.
 * - tools/list: PayPal's tools, minus the money-moving ones the guard does not cover.
 * - tools/call: read tools are forwarded to PayPal's server; refunds and invoice create, send and cancel go through
 *   the same guard as the support agent, with the same confirmed limits and the same local store, so a hold shows
 *   up on the app's owner page; a tool the guard does not know is held.
 *
 * Logs go to stderr (stdout is the MCP channel). Nothing secret is logged.
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ActionType,
  GUARD_NOTE,
  Guard,
  type Logger,
  PayPalClient,
  PayPalExecutor,
  PayPalFacts,
  actionFromToolCall,
  assertSandboxEnv,
  classifyTool,
  kettleAndKesar,
  storePolicySource,
  toolOutput,
} from "@align-agent/paypal-guard";
import { loadEnvFiles } from "@align-agent/paypal-guard/env";
import { sqliteStore } from "@align-agent/paypal-guard/store/sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
loadEnvFiles(ROOT);
assertSandboxEnv();
const DATA_DIR = process.env.ALIGN_PAY_DATA_DIR ?? join(ROOT, ".data");

const log: Logger = {
  info: (m, d) => process.stderr.write(`[align-pay mcp] ${m} ${d ? JSON.stringify(d) : ""}\n`),
  warn: (m, d) => process.stderr.write(`[align-pay mcp] ${m} ${d ? JSON.stringify(d) : ""}\n`),
  error: (m, d) => process.stderr.write(`[align-pay mcp] ${m} ${d ? JSON.stringify(d) : ""}\n`),
};

const store = sqliteStore(join(DATA_DIR, "align-pay.db"));
const paypal = new PayPalClient({ clientId: process.env.PAYPAL_CLIENT_ID ?? "", clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "", log });
const directory = kettleAndKesar();
const guard = new Guard({
  store,
  facts: new PayPalFacts({ paypal, store, directory, log }),
  executor: new PayPalExecutor(paypal),
  policies: storePolicySource(store, () => "the ALIGN Pay app has not synced a ledger yet (run pnpm demo once)"),
  directory,
  log,
});

// PayPal's MCP server, as a child, with a sandbox access token from ALIGN Pay's own client.
const require = createRequire(import.meta.url);
let child: Client | null = null;
let childTokenExpires = 0;
async function paypalMcp(): Promise<Client> {
  if (child && Date.now() < childTokenExpires) return child;
  if (child) await child.close().catch(() => {});
  const token = await paypal.accessToken(true);
  childTokenExpires = Date.now() + 8 * 60 * 60 * 1000;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [require.resolve("@paypal/mcp/dist/index.js"), "--tools=all"],
    env: { PATH: process.env.PATH ?? "", PAYPAL_ACCESS_TOKEN: token, PAYPAL_ENVIRONMENT: "SANDBOX" },
    stderr: "ignore",
  });
  child = new Client({ name: "align-pay-mcp-guard", version: "0.1.0" });
  await child.connect(transport);
  return child;
}

const server = new Server({ name: "align-pay-guarded-paypal", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await (await paypalMcp()).listTools();
  return {
    tools: tools
      .filter((t) => classifyTool(t.name).class !== "not_exposed")
      .map((t) => (classifyTool(t.name).class === "guarded" ? { ...t, description: `${t.description ?? t.name}${GUARD_NOTE}` } : t)),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  const c = classifyTool(name);
  const ctx = { requestedBy: "coding-agent", log };
  if (c.class === "not_exposed") {
    return { content: [{ type: "text" as const, text: `${name} is not available through ALIGN Pay: ${c.why}.` }], isError: true };
  }
  if (c.class === "read") {
    log.info("read tool", { tool: name });
    return (await (await paypalMcp()).callTool({ name, arguments: args })) as never;
  }
  const result =
    c.class === "guarded"
      ? await guard.handle(actionFromToolCall(name, c.action as ActionType, args, ctx))
      : await guard.handleUnknownTool(name, args, ctx);
  const out = toolOutput(result);
  return { content: [{ type: "text" as const, text: JSON.stringify(out) }], structuredContent: out as unknown as Record<string, unknown> };
});

await server.connect(new StdioServerTransport());
log.info("ready: PayPal's MCP server (sandbox) behind the ALIGN Pay guard");
