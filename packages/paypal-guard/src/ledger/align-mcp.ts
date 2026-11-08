import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { normaliseStatement, type Receipt } from "../policy";
import type { Ledger, LedgerDecision, LedgerSnapshot } from "./types";

const KEY_RE = /\b([A-Z][A-Z0-9]{0,5}-[1-9][0-9]{0,8})\b/g;

/** ALIGN Pay calls only ALIGN's read tools. It never calls record_decision or ask_owner. */
export const ALIGN_READ_TOOLS = ["search_decisions", "get_decision"] as const;

export interface AlignMcpOptions {
  /** e.g. "npx -y @align-agent/cli@0.1.7" */
  cli: string;
  /** The repository ALIGN answers for (`align mcp --cwd <dir>`). */
  repoDir: string;
  /** Decisions are matched to these statements. */
  statements: readonly string[];
  timeoutMs?: number;
  queries?: string[];
}

type CallResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Every object inside `v` (depth-first), for reading ALIGN's structured answers without depending on their nesting. */
function* objects(v: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 8 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) yield* objects(x, depth + 1);
    return;
  }
  yield v as Record<string, unknown>;
  for (const x of Object.values(v)) yield* objects(x, depth + 1);
}

const text = (r: CallResult): string => (r.content ?? []).map((c) => c.text ?? "").join("\n");

export function keysFromSearch(r: CallResult): string[] {
  const keys = new Set<string>();
  for (const o of objects(r.structuredContent)) {
    if (typeof o.key === "string" && /^[A-Z][A-Z0-9]{0,5}-[1-9][0-9]{0,8}$/.test(o.key) && !o.key.startsWith("Q-")) keys.add(o.key);
  }
  if (keys.size === 0) for (const m of text(r).matchAll(KEY_RE)) if (!m[1]!.startsWith("Q-")) keys.add(m[1]!);
  return [...keys];
}

export function decisionFromGet(key: string, r: CallResult, statements: readonly string[]): LedgerDecision | null {
  let entry: Record<string, unknown> | null = null;
  for (const o of objects(r.structuredContent)) {
    if (o.key === key && typeof o.statement === "string") {
      entry = o;
      break;
    }
  }
  const body = text(r);
  if (!entry) {
    // No structured answer: accept it only if the text carries one of the store's statements verbatim.
    const statement = statements.find((s) => normaliseStatement(body).includes(normaliseStatement(s)));
    if (!statement) return null;
    const quotes = body
      .split("\n")
      .filter((l) => l.trim().startsWith(">"))
      .map((l) => l.replace(/^\s*>\s?/, "").trim())
      .filter(Boolean);
    const status = /\bconfirmed\b/i.test(body) ? "confirmed" : "unknown";
    return {
      key,
      statement,
      status,
      revision: null,
      why: null,
      receipts: (quotes.length ? quotes : [statement]).map((q) => ({ quote: q, source: "ALIGN" })),
      confirmedBy: null,
      confirmedAt: null,
    };
  }
  const evidence = Array.isArray(entry.evidence) ? (entry.evidence as Record<string, unknown>[]) : [];
  const receipts: Receipt[] = evidence
    .filter((e) => typeof e.quote === "string" && e.quote)
    .map((e) => ({
      quote: e.quote as string,
      source: `ALIGN · ${typeof e.kind === "string" ? e.kind : "receipt"}`,
      at: typeof e.created_at === "string" ? e.created_at : null,
      url: typeof e.url === "string" ? e.url : null,
    }));
  const confirmedBy = entry.confirmed_by as { display_name?: string } | null | undefined;
  return {
    key,
    statement: entry.statement as string,
    status: typeof entry.status === "string" ? entry.status : "unknown",
    revision: typeof entry.revision === "number" ? entry.revision : null,
    why: typeof entry.rationale === "string" ? entry.rationale : null,
    receipts: receipts.length ? receipts : [{ quote: entry.statement as string, source: "ALIGN" }],
    confirmedBy: confirmedBy?.display_name ?? null,
    confirmedAt: typeof entry.confirmed_at === "string" ? entry.confirmed_at : null,
  };
}

/** Starts `align mcp --cwd <repo>` over stdio and reads the store's confirmed decisions through ALIGN's read tools. */
export class AlignMcpLedger implements Ledger {
  readonly mode = "align" as const;
  constructor(private readonly o: AlignMcpOptions) {}

  async sync(): Promise<LedgerSnapshot> {
    const parts = this.o.cli.trim().split(/\s+/);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      // ALIGN needs none of ALIGN Pay's keys: they are not passed to the child.
      if (v !== undefined && !/^(PAYPAL_|GOOGLE_|GEMINI_)/.test(k)) env[k] = v;
    }
    const transport = new StdioClientTransport({
      command: parts[0]!,
      args: [...parts.slice(1), "mcp", "--cwd", this.o.repoDir],
      cwd: this.o.repoDir,
      env,
      stderr: "ignore",
    });
    const client = new Client({ name: "align-pay", version: "0.1.0" });
    const ms = this.o.timeoutMs ?? 45_000;
    try {
      await withTimeout(client.connect(transport), ms, "Starting align mcp");
      const listed = await withTimeout(client.listTools(), 15_000, "Listing ALIGN's tools");
      const names = new Set(listed.tools.map((t) => t.name));
      for (const t of ALIGN_READ_TOOLS) if (!names.has(t)) throw new Error(`ALIGN's MCP server has no ${t} tool`);

      const call = (name: (typeof ALIGN_READ_TOOLS)[number], args: Record<string, unknown>) =>
        withTimeout(client.callTool({ name, arguments: args }) as Promise<CallResult>, 15_000, `ALIGN ${name}`);

      const keys = new Set<string>();
      for (const q of this.o.queries ?? ["refund", "invoice", "dispute"]) {
        const r = await call("search_decisions", { query: q, status: "confirmed", limit: 50 });
        if (r.isError) throw new Error(`ALIGN search_decisions failed: ${text(r).slice(0, 160)}`);
        for (const k of keysFromSearch(r)) keys.add(k);
      }
      const want = new Map(this.o.statements.map((s) => [normaliseStatement(s), s]));
      const decisions: LedgerDecision[] = [];
      for (const key of keys) {
        const r = await call("get_decision", { key });
        if (r.isError) continue;
        const d = decisionFromGet(key, r, this.o.statements);
        if (d && d.status === "confirmed" && want.has(normaliseStatement(d.statement))) decisions.push(d);
      }
      // One decision per statement: the newest key wins if a rule was recorded twice.
      const byStatement = new Map<string, LedgerDecision>();
      for (const d of decisions.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }))) {
        byStatement.set(normaliseStatement(d.statement), d);
      }
      return {
        mode: "align",
        syncedAt: new Date().toISOString(),
        source: "ALIGN, through align mcp",
        decisions: [...byStatement.values()],
      };
    } finally {
      await client.close().catch(() => {});
    }
  }
}
