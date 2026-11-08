import { type Action, type ActionType, usd } from "./actions";
import type { Facts, InvoiceFacts, RefundFacts } from "./facts";
import { type Policy, type Rule, governsAction } from "./policy";

export type Outcome = "allow" | "hold" | "block";

export type VerdictCode =
  | "allowed"
  | "no_decision"
  | "no_ledger"
  | "rule_hold"
  | "rule_block"
  | "missing_facts"
  | "above_remaining"
  | "invalid_amount"
  | "currency"
  | "not_customer_order"
  | "unknown_customer"
  | "no_customer"
  | "invalid_request"
  | "unknown_tool";

export type FactValue = string | number | boolean | null;

/** One check that ran: a rule of a confirmed policy, or one of the guard's own checks. */
export interface CheckResult {
  source: "policy" | "guard";
  check: string;
  decisionKey: string | null;
  statement: string | null;
  quotes: string[];
  rule: Rule | null;
  outcome: Outcome;
  code: VerdictCode;
  reason: string;
  facts: Record<string, FactValue>;
}

export interface Verdict {
  outcome: Outcome;
  code: VerdictCode;
  reason: string;
  /** The decision the outcome rests on: the one that allowed it, or the first that held or blocked it. */
  primaryKey: string | null;
  requestedUsd: number | null;
  results: CheckResult[];
  /** The PayPal facts the verdict used, for the receipt card. */
  factsUsed: Record<string, FactValue>;
  approved: boolean;
  evaluatedAt: string;
}

function factsUsed(f: Facts, now: Date): Record<string, FactValue> {
  if (f.kind === "refund") {
    return {
      order: f.orderId,
      capture: f.captureId,
      captured: f.capturedUsd,
      refunded: f.refundedUsd,
      remaining: f.remainingUsd,
      customer: f.customerId,
      openDisputes: f.openDisputes,
      refundsInLast30Days:
        f.customerRefunds === null ? null : f.customerRefunds.filter((r) => Date.parse(r.at) >= now.getTime() - 30 * 86_400_000).length,
    };
  }
  return { invoice: f.invoiceId, invoiceTotal: f.totalUsd, terms: f.termType, discountPct: f.discountPct, customer: f.recipientCustomerId };
}

export interface EvaluateOptions {
  /** The owner approved this action: hold rules (and "nobody decided this") stop holding; blocks still block. */
  approved?: boolean;
  ledger?: { available: boolean; reason?: string };
}

const RANK: Record<Outcome, number> = { allow: 0, hold: 1, block: 2 };

function guardCheck(
  check: string,
  outcome: Outcome,
  code: VerdictCode,
  reason: string,
  facts: Record<string, FactValue> = {},
): CheckResult {
  return { source: "guard", check, decisionKey: null, statement: null, quotes: [], rule: null, outcome, code, reason, facts };
}

function ruleApplies(rule: Rule, type: ActionType): boolean {
  switch (rule.kind) {
    case "auto_max_amount":
    case "per_customer_count":
    case "block_if_open_dispute":
      return rule.action === type;
    case "invoice_terms":
      return type === "invoice.create" || type === "invoice.send";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EPS = 0.004;

function refundGuardChecks(action: Action, f: RefundFacts): { checks: CheckResult[]; requested: number | null } {
  const checks: CheckResult[] = [];
  if (!f.orderId || f.capturedUsd === null || !f.captureId || f.remainingUsd === null) {
    checks.push(
      guardCheck("order_facts", "hold", "missing_facts", "PayPal's record of this order could not be read, so nothing moves.", {
        order: f.orderId,
        missing: f.missing.join(", ") || "order",
      }),
    );
    return { checks, requested: null };
  }
  if (f.currency !== "USD") {
    checks.push(guardCheck("currency", "hold", "currency", "Only USD orders are handled automatically.", { currency: f.currency }));
  }
  if (!action.customerId) {
    checks.push(guardCheck("customer", "hold", "no_customer", "No customer is attached to this request, so the owner has to look."));
  } else {
    if (!f.customerId) {
      checks.push(
        guardCheck("customer", "hold", "unknown_customer", "PayPal's order carries no store customer, so the owner has to look.", {
          order: f.orderId,
        }),
      );
    } else if (f.customerId !== action.customerId) {
      checks.push(
        guardCheck("customer", "block", "not_customer_order", "That order belongs to a different customer.", {
          order: f.orderId,
        }),
      );
    }
  }
  const requested = action.requested.amountUsd ?? f.remainingUsd;
  if (!(requested > 0)) {
    checks.push(guardCheck("amount", "block", "invalid_amount", "A refund needs a positive amount.", { requested }));
  } else if (requested > f.remainingUsd + EPS) {
    checks.push(
      guardCheck(
        "remaining_refundable",
        "block",
        "above_remaining",
        `PayPal shows only ${usd(f.remainingUsd)} left to refund on this order; ${usd(requested)} was asked.`,
        { captured: f.capturedUsd, refunded: f.refundedUsd, remaining: f.remainingUsd, requested },
      ),
    );
  }
  return { checks, requested };
}

function invoiceGuardChecks(action: Action, f: InvoiceFacts): CheckResult[] {
  const checks: CheckResult[] = [];
  if (f.problem) {
    checks.push(guardCheck("invoice_request", "hold", "invalid_request", f.problem));
  }
  if (f.totalUsd === null) {
    checks.push(
      guardCheck("invoice_facts", "hold", "missing_facts", "The invoice's total could not be read, so nothing moves.", {
        invoice: f.invoiceId,
        missing: f.missing.join(", ") || "invoice",
      }),
    );
  } else if (f.currency !== "USD") {
    checks.push(guardCheck("currency", "hold", "currency", "Only USD invoices are handled automatically.", { currency: f.currency }));
  }
  if (!action.customerId) {
    checks.push(guardCheck("customer", "hold", "no_customer", "No customer is attached to this request, so the owner has to look."));
  } else if (f.totalUsd !== null) {
    if (!f.recipientCustomerId) {
      checks.push(guardCheck("customer", "hold", "unknown_customer", "The invoice is not addressed to a known store customer."));
    } else if (f.recipientCustomerId !== action.customerId) {
      checks.push(guardCheck("customer", "block", "not_customer_order", "That invoice is addressed to a different customer."));
    }
  }
  return checks;
}

function evaluateRule(
  rule: Rule,
  policy: Policy,
  action: Action,
  facts: Facts,
  requested: number | null,
  now: Date,
): CheckResult {
  const base = {
    source: "policy" as const,
    check: rule.kind,
    decisionKey: policy.decisionKey,
    statement: policy.statement,
    quotes: policy.receipts.map((r) => r.quote),
    rule,
  };
  const missing = (what: string, f: Record<string, FactValue> = {}): CheckResult => ({
    ...base,
    outcome: "hold",
    code: "missing_facts",
    reason: `${what} could not be read from PayPal, so the owner has to look.`,
    facts: f,
  });
  const over = (outcome: "hold" | "block", reason: string, f: Record<string, FactValue>): CheckResult => ({
    ...base,
    outcome,
    code: outcome === "block" ? "rule_block" : "rule_hold",
    reason,
    facts: f,
  });
  const pass = (reason: string, f: Record<string, FactValue>): CheckResult => ({ ...base, outcome: "allow", code: "allowed", reason, facts: f });

  switch (rule.kind) {
    case "auto_max_amount": {
      if (facts.kind === "refund") {
        if (requested === null || facts.refundedUsd === null) return missing("The order's refunds so far");
        // "per order": what was already refunded on this order counts toward the limit.
        const total = Math.round((facts.refundedUsd + requested) * 100) / 100;
        const f = { requested, refundedBefore: facts.refundedUsd, orderTotalRefunded: total, max: rule.maxUsd };
        return total > rule.maxUsd + EPS
          ? over("hold", `A refund of ${usd(requested)} takes this order's refunds to ${usd(total)}, above ${usd(rule.maxUsd)}: the owner approves it first.`, f)
          : pass(`${usd(requested)} is within the ${usd(rule.maxUsd)} the agent may refund on its own.`, f);
      }
      if (facts.totalUsd === null) return missing("The invoice total");
      const f = { invoiceTotal: facts.totalUsd, max: rule.maxUsd };
      return facts.totalUsd > rule.maxUsd + EPS
        ? over("hold", `The invoice is ${usd(facts.totalUsd)}, above ${usd(rule.maxUsd)}: the owner approves it before it is sent.`, f)
        : pass(`The invoice is ${usd(facts.totalUsd)}, within ${usd(rule.maxUsd)}.`, f);
    }
    case "per_customer_count": {
      if (facts.kind !== "refund") return missing("The customer's refund history");
      if (!facts.customerId || facts.customerRefunds === null) return missing("The customer's refund history");
      const since = now.getTime() - rule.windowDays * DAY_MS;
      const inWindow = facts.customerRefunds.filter((r) => Date.parse(r.at) >= since);
      const f = { customer: facts.customerId, refundsInWindow: inWindow.length, windowDays: rule.windowDays, max: rule.max };
      return inWindow.length + 1 > rule.max
        ? over(
            rule.over,
            `This customer already had ${inWindow.length} refund${inWindow.length === 1 ? "" : "s"} in the last ${rule.windowDays} days; at most ${rule.max} ${rule.max === 1 ? "is" : "are"} allowed.`,
            f,
          )
        : pass(`No earlier refund for this customer in the last ${rule.windowDays} days.`, f);
    }
    case "block_if_open_dispute": {
      if (facts.kind !== "refund") return missing("The order's disputes");
      if (facts.openDisputes === null) return missing("The order's disputes", { capture: facts.captureId });
      const f = { capture: facts.captureId, openDisputes: facts.openDisputes };
      return facts.openDisputes > 0
        ? over("block", `The order has an open PayPal dispute (${facts.disputeIds.join(", ")}); it is answered there instead.`, f)
        : pass("No open PayPal dispute on this order.", f);
    }
    case "invoice_terms": {
      if (facts.kind !== "invoice") return missing("The invoice terms");
      if (facts.termType === null || facts.discountPct === null) return missing("The invoice terms");
      const f = {
        terms: facts.termType,
        allowedTerms: rule.allowedTerms.join(", "),
        discountPct: facts.discountPct,
        maxDiscountPct: rule.maxDiscountPct,
      };
      const problems: string[] = [];
      if (!rule.allowedTerms.includes(facts.termType as never)) {
        problems.push(`terms ${facts.termType.replace("NET_", "net ")} instead of ${rule.allowedTerms.map((t) => t.replace("NET_", "net ")).join(" or ")}`);
      }
      if (facts.discountPct > rule.maxDiscountPct + 1e-9) {
        problems.push(`a ${facts.discountPct}% discount, above ${rule.maxDiscountPct}%`);
      }
      return problems.length
        ? over(rule.over, `The invoice has ${problems.join(" and ")}.`, f)
        : pass(`Terms ${facts.termType.replace("NET_", "net ")} and a ${facts.discountPct}% discount are within the rule.`, f);
    }
  }
}

/**
 * The guard's decision for one action: a pure function of the action, PayPal's facts, the confirmed policies and the
 * time. No model output reaches it. Precedence is block > hold > allow; a rule whose facts are missing holds.
 */
export function evaluate(action: Action, facts: Facts, policies: Policy[], now: Date, opts: EvaluateOptions = {}): Verdict {
  const results: CheckResult[] = [];
  let requested: number | null = null;

  if (facts.kind === "refund" && action.type === "refund.create") {
    const r = refundGuardChecks(action, facts);
    results.push(...r.checks);
    requested = r.requested;
  } else if (facts.kind === "invoice" && action.type !== "refund.create") {
    results.push(...invoiceGuardChecks(action, facts));
    requested = facts.totalUsd;
  } else {
    results.push(guardCheck("facts", "hold", "missing_facts", "The facts for this action could not be read, so nothing moves."));
  }

  if (opts.ledger && !opts.ledger.available) {
    results.push(
      guardCheck("ledger", "hold", "no_ledger", `The decision ledger is not available${opts.ledger.reason ? ` (${opts.ledger.reason})` : ""}, so nothing moves.`),
    );
  }

  const applicable = policies.filter((p) => governsAction(p, action.type));
  if (applicable.length === 0) {
    results.push(guardCheck("decision", "hold", "no_decision", "Nobody decided this: no confirmed decision covers this kind of action, so the owner has to look."));
  }
  for (const p of applicable) {
    for (const rule of p.limits!.rules) {
      if (!ruleApplies(rule, action.type)) continue;
      results.push(evaluateRule(rule, p, action, facts, requested, now));
    }
  }

  // An approval lifts holds that exist because a person had to look (hold rules, nobody decided, no or unknown
  // customer). It never lifts a block, and never a hold caused by missing facts, a missing ledger or another currency.
  const APPROVABLE: VerdictCode[] = ["rule_hold", "no_decision", "no_customer", "unknown_customer"];
  const effective = results.map((r) =>
    opts.approved && r.outcome === "hold" && APPROVABLE.includes(r.code)
      ? { ...r, outcome: "allow" as const, reason: `${r.reason} The owner approved it.` }
      : r,
  );

  const worst = effective.reduce<Outcome>((w, r) => (RANK[r.outcome] > RANK[w] ? r.outcome : w), "allow");
  const deciding = effective.find((r) => r.outcome === worst && worst !== "allow");
  // A block resting only on PayPal's facts (more than is left to refund) still names a decision that applies, if any.
  const firstPolicyHit =
    effective.find((r) => r.source === "policy" && r.outcome === worst && worst !== "allow") ??
    (worst === "block" ? effective.find((r) => r.source === "policy" && r.outcome === "hold") : undefined);
  const amountPolicy = effective.find((r) => r.source === "policy" && r.check === "auto_max_amount");
  const primaryKey =
    worst === "allow"
      ? (amountPolicy?.decisionKey ?? applicable[0]?.decisionKey ?? null)
      : (firstPolicyHit?.decisionKey ?? null);

  return {
    outcome: worst,
    code: deciding?.code ?? "allowed",
    reason:
      deciding?.reason ??
      (opts.approved ? "The owner approved it, and every rule still holds." : "Every confirmed rule that applies allows it."),
    primaryKey,
    requestedUsd: requested,
    results: effective,
    factsUsed: factsUsed(facts, now),
    approved: !!opts.approved,
    evaluatedAt: now.toISOString(),
  };
}
