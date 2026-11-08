import { type Action, newActionId } from "./actions";
import type { StoreDirectory } from "./directory";
import { type Verdict, evaluate } from "./engine";
import type { ExecResult, Executor } from "./execute";
import { type Facts, type FactsSource, missingFactsFor } from "./facts";
import { type Logger, silentLogger } from "./paypal/client";
import type { Policy } from "./policy";
import type { ActionRecord, Store } from "./store/types";

export type GuardStatus = "allowed" | "held" | "blocked" | "denied" | "failed";

/** What the agent (and the receipt card) gets back. */
export interface GuardResult {
  status: GuardStatus;
  actionId: string;
  key: string | null;
  reason: string;
  paypalId?: string;
  alternative?: string;
}

export interface PolicySource {
  /** The confirmed and draft policies for the current ledger snapshot, and whether a ledger is there at all. */
  current(): Promise<{ ledger: { available: boolean; reason?: string }; policies: Policy[] }>;
}

export interface GuardDeps {
  store: Store;
  facts: FactsSource;
  executor: Executor;
  policies: PolicySource;
  directory?: StoreDirectory;
  now?: () => Date;
  log?: Logger;
  /** One plain sentence for held and blocked cards. Must answer within 3 s; the deterministic reason is the fallback. */
  explain?: (rec: ActionRecord) => Promise<string | null>;
}

export interface Decider {
  approver: string;
  note?: string;
}

const STATUS_OF: Record<ActionRecord["status"], GuardStatus> = {
  executing: "held",
  executed: "allowed",
  held: "held",
  blocked: "blocked",
  denied: "denied",
  failed: "failed",
};

export function resultOf(rec: ActionRecord): GuardResult {
  return {
    status: STATUS_OF[rec.status],
    actionId: rec.id,
    key: rec.decisionKey,
    reason:
      rec.status === "denied"
        ? `The owner declined it${rec.approverNote ? `: ${rec.approverNote}` : "."}`
        : rec.status === "failed"
          ? `PayPal did not complete it: ${rec.error ?? "unknown error"}`
          : rec.status === "held"
            ? `Held for the owner: ${rec.verdict.reason}`
            : rec.verdict.reason,
    ...(rec.paypalId ? { paypalId: rec.paypalId } : {}),
    ...(rec.alternative ? { alternative: rec.alternative } : {}),
  };
}

function alternativeFor(v: Verdict, facts: Facts, directory?: StoreDirectory): string | undefined {
  if (v.outcome === "hold") return "Tell the customer the owner has been asked and will approve or decline it.";
  if (v.outcome !== "block") return undefined;
  const hit = v.results.find((r) => r.outcome === "block" && r.source === "policy") ?? v.results.find((r) => r.outcome === "block");
  switch (hit?.check) {
    case "per_customer_count":
      return `Refuse politely and ask the customer to email the owner at ${directory?.ownerEmail ?? "the store's email address"}.`;
    case "block_if_open_dispute":
      return `Do not refund. The order has an open PayPal dispute${
        facts.kind === "refund" && facts.disputeIds.length ? ` (${facts.disputeIds.join(", ")})` : ""
      }; the owner answers it in PayPal's Resolution Center.`;
    case "invoice_terms": {
      const r = hit.rule?.kind === "invoice_terms" ? hit.rule : null;
      return r
        ? `Offer ${r.allowedTerms.map((t) => t.replace("NET_", "net ")).join(" or ")} terms with at most ${r.maxDiscountPct}% discount instead.`
        : undefined;
    }
    case "remaining_refundable":
      return facts.kind === "refund" && facts.remainingUsd !== null
        ? `At most $${facts.remainingUsd.toFixed(2)} is left to refund on that order.`
        : undefined;
    case "customer":
      return "Only the customer's own orders and invoices can be changed.";
    default:
      return undefined;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<null>((r) => (t = setTimeout(() => r(null), ms)))]);
  } catch {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * The guard. Every money-moving tool call becomes an Action; the guard reads PayPal's facts, evaluates the confirmed
 * limits deterministically, and then executes (allowed), stores a hold (held) or refuses (blocked).
 */
export class Guard {
  private readonly log: Logger;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly d: GuardDeps) {
    this.log = d.log ?? silentLogger;
  }

  private now(): Date {
    return this.d.now ? this.d.now() : new Date();
  }

  /**
   * Money actions run one at a time, whatever their id: a second refund reads PayPal's facts only after the first has
   * executed, so two parallel tool calls cannot both fit under a limit meant for one. A double click or a retried
   * request on the same action cannot execute twice either.
   */
  private async exclusive<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    const id = "money";
    while (this.locks.has(id)) await this.locks.get(id)!.catch(() => {});
    const p = fn();
    this.locks.set(id, p);
    try {
      return await p;
    } finally {
      this.locks.delete(id);
    }
  }

  async handle(action: Action): Promise<GuardResult> {
    return this.exclusive(action.id, async () => {
      const existing = this.d.store.getAction(action.id);
      if (existing) return resultOf(existing);

      const { ledger, policies } = await this.d.policies.current();
      const facts = await this.readFacts(action);
      const verdict = evaluate(action, facts, policies, this.now(), { ledger });
      const ts = this.now().toISOString();
      const rec: ActionRecord = {
        ...action,
        status: verdict.outcome === "allow" ? "executing" : verdict.outcome === "hold" ? "held" : "blocked",
        verdict,
        firstVerdict: verdict,
        decisionKey: verdict.primaryKey,
        createdAt: ts,
        updatedAt: ts,
        ...this.factFields(facts),
      };
      const alt = alternativeFor(verdict, facts, this.d.directory);
      if (alt) rec.alternative = alt;
      this.d.store.putAction(rec);
      this.log.info("guard verdict", { action: rec.id, type: rec.type, outcome: verdict.outcome, code: verdict.code, key: verdict.primaryKey });

      if (verdict.outcome === "allow") return this.run(rec, facts, verdict);
      await this.addExplanation(rec);
      return resultOf(rec);
    });
  }

  /** A call to a tool that is not in the classification table: recorded and held, never executed. */
  async handleUnknownTool(tool: string, args: unknown, ctx: { customerId?: string; scenarioId?: string; requestedBy?: string }) {
    const ts = this.now().toISOString();
    const verdict: Verdict = {
      outcome: "hold",
      code: "unknown_tool",
      reason: `"${tool}" is not a tool ALIGN Pay knows, so it is treated as moving money and held.`,
      primaryKey: null,
      requestedUsd: null,
      results: [],
      factsUsed: {},
      approved: false,
      evaluatedAt: ts,
    };
    const rec: ActionRecord = {
      id: newActionId(),
      type: "unknown",
      tool,
      args,
      target: {},
      requested: {},
      requestedBy: ctx.requestedBy ?? "support-agent",
      ...(ctx.customerId ? { customerId: ctx.customerId } : {}),
      ...(ctx.scenarioId ? { scenarioId: ctx.scenarioId } : {}),
      status: "held",
      verdict,
      firstVerdict: verdict,
      decisionKey: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.log.warn("unknown tool held", { tool });
    this.d.store.putAction(rec);
    return resultOf(rec);
  }

  /** The owner approves a held action: facts are read again, block rules still block, then it executes. */
  async approve(id: string, who: Decider): Promise<GuardResult> {
    return this.exclusive(id, async () => {
      const rec = this.d.store.getAction(id);
      if (!rec) throw new Error("No such action");
      if (rec.status !== "held") return resultOf(rec);
      if (rec.type === "unknown") {
        return { ...resultOf(rec), reason: "ALIGN Pay cannot run a tool it does not know; it stays held." };
      }
      const action = rec as Action & ActionRecord;
      const { ledger, policies } = await this.d.policies.current();
      const facts = await this.readFacts(action);
      const verdict = evaluate(action, facts, policies, this.now(), { ledger, approved: true });
      Object.assign(rec, this.factFields(facts), {
        verdict,
        approver: who.approver,
        approverNote: who.note,
        decidedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
      });
      if (verdict.outcome === "block") {
        rec.status = "blocked";
        rec.decisionKey = verdict.primaryKey ?? rec.decisionKey;
        const alt = alternativeFor(verdict, facts, this.d.directory);
        if (alt) rec.alternative = alt;
        this.d.store.putAction(rec);
        return resultOf(rec);
      }
      if (verdict.outcome === "hold") {
        this.d.store.putAction(rec);
        return { ...resultOf(rec), reason: `Still held: ${verdict.reason}` };
      }
      // Keep the decision the hold came from as the key on the PayPal object.
      const heldKey = rec.firstVerdict.results.find((r) => r.outcome === "hold" && r.decisionKey)?.decisionKey;
      const v: Verdict = { ...verdict, primaryKey: heldKey ?? verdict.primaryKey };
      rec.decisionKey = v.primaryKey;
      rec.status = "executing";
      delete rec.alternative;
      this.d.store.putAction(rec);
      return this.run(rec, facts, v);
    });
  }

  async deny(id: string, who: Decider): Promise<GuardResult> {
    return this.exclusive(id, async () => {
      const rec = this.d.store.getAction(id);
      if (!rec) throw new Error("No such action");
      if (rec.status !== "held") return resultOf(rec);
      Object.assign(rec, {
        status: "denied",
        approver: who.approver,
        approverNote: who.note,
        decidedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString(),
      });
      this.d.store.putAction(rec);
      return resultOf(rec);
    });
  }

  /**
   * PayPal's facts for an action. An action without a well-formed target (the agent sent a malformed or made-up id)
   * never reaches PayPal, and facts that cannot be read are missing: both end up held.
   */
  private async readFacts(action: Action): Promise<Facts> {
    const t = action.target;
    const hasTarget = action.type === "refund.create" ? !!(t.orderId || t.captureId) : action.type === "invoice.create" ? true : !!t.invoiceId;
    if (!hasTarget) return missingFactsFor(action.type, "target");
    try {
      return await this.d.facts.facts(action);
    } catch (e) {
      this.log.warn("facts failed", { action: action.id, error: (e as Error).message.slice(0, 200) });
      return missingFactsFor(action.type, "facts");
    }
  }

  private factFields(facts: Facts): Partial<ActionRecord> {
    if (facts.kind === "refund") {
      return {
        ...(facts.orderId ? { orderId: facts.orderId } : {}),
        ...(facts.captureId ? { captureId: facts.captureId } : {}),
        ...(facts.customerId ? { paypalCustomerId: facts.customerId } : {}),
      };
    }
    if (facts.kind === "invoice") {
      return {
        ...(facts.invoiceId ? { invoiceId: facts.invoiceId } : {}),
        ...(facts.draft ? { invoiceDraft: facts.draft } : {}),
        ...(facts.totalUsd !== null ? { amountUsd: facts.totalUsd } : {}),
      };
    }
    return {};
  }

  private async run(rec: ActionRecord, facts: Facts, verdict: Verdict): Promise<GuardResult> {
    let r: ExecResult;
    try {
      r = await this.d.executor.execute(rec, facts, verdict);
    } catch (e) {
      rec.status = "failed";
      rec.error = (e as Error).message.slice(0, 300);
      rec.updatedAt = this.now().toISOString();
      this.d.store.putAction(rec);
      this.log.error("execution failed", { action: rec.id, error: rec.error });
      return resultOf(rec);
    }
    Object.assign(rec, {
      status: "executed",
      paypalId: r.paypalId,
      paypalStatus: r.paypalStatus,
      executedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
      ...(r.amountUsd !== undefined ? { amountUsd: r.amountUsd } : {}),
      ...(rec.type === "invoice.create" ? { invoiceId: r.paypalId } : {}),
    });
    this.d.store.putAction(rec);
    this.log.info("executed", { action: rec.id, type: rec.type, paypal_id: r.paypalId, key: rec.decisionKey });
    return resultOf(rec);
  }

  private async addExplanation(rec: ActionRecord): Promise<void> {
    if (!this.d.explain) return;
    const text = await withTimeout(this.d.explain(rec), 3000);
    if (text) {
      rec.explanation = text.slice(0, 300);
      this.d.store.putAction(rec);
    }
  }
}

export function createGuard(d: GuardDeps): Guard {
  return new Guard(d);
}
