import { z } from "zod";
import { ActionTypeSchema, TermTypeSchema, type ActionType, usd } from "./actions";

/** The structured limits a model drafts from one decision, and a person confirms. */
export const RuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("auto_max_amount"),
    action: z.enum(["refund.create", "invoice.send"]),
    maxUsd: z.number().nonnegative().max(1_000_000),
    above: z.literal("hold"),
  }),
  z.strictObject({
    kind: z.literal("per_customer_count"),
    action: z.literal("refund.create"),
    max: z.number().int().min(0).max(1000),
    windowDays: z.number().int().min(1).max(366),
    over: z.enum(["block", "hold"]),
  }),
  z.strictObject({
    kind: z.literal("block_if_open_dispute"),
    action: z.literal("refund.create"),
  }),
  z.strictObject({
    kind: z.literal("invoice_terms"),
    allowedTerms: z.array(TermTypeSchema).min(1),
    maxDiscountPct: z.number().min(0).max(100),
    over: z.enum(["block", "hold"]),
  }),
]);
export type Rule = z.infer<typeof RuleSchema>;

export const LimitsSchema = z.strictObject({
  version: z.literal(1),
  governs: z.array(ActionTypeSchema).min(1),
  rules: z.array(RuleSchema).min(1),
});
export type Limits = z.infer<typeof LimitsSchema>;

export interface Receipt {
  quote: string;
  /** Where the quote came from, e.g. "ALIGN · confirmation" or "local fixture". */
  source: string;
  at?: string | null;
  url?: string | null;
}

export type PolicyStatus = "draft" | "confirmed";

/** One ALIGN decision and the limits drafted from it. Only `confirmed` policies are ever enforced. */
export interface Policy {
  decisionKey: string;
  statement: string;
  decisionRevision: number | null;
  receipts: Receipt[];
  ledgerMode: "sample" | "align";
  status: PolicyStatus;
  limits: Limits | null;
  /** The model's one-paragraph "how I read this rule". */
  reading: string | null;
  draftedBy: string | null;
  draftedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmMethod: "owner page" | null;
  /** Why it is still a draft, when it is. */
  note: string | null;
}

// --- canonical form and comparison ------------------------------------------------------------------------------

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Sorted keys, sorted `governs`, sorted terms, and rules sorted by kind then action. */
export function canonicalLimits(limits: Limits): Limits {
  const rules = limits.rules
    .map((r) => (r.kind === "invoice_terms" ? { ...r, allowedTerms: [...r.allowedTerms].sort() } : r))
    .sort((a, b) => {
      const ka = `${a.kind}|${"action" in a ? a.action : ""}`;
      const kb = `${b.kind}|${"action" in b ? b.action : ""}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  return sortKeys({ version: limits.version, governs: [...new Set(limits.governs)].sort(), rules }) as Limits;
}

export const canonicalJson = (limits: Limits): string => JSON.stringify(canonicalLimits(limits));

export function limitsEqual(a: Limits, b: Limits): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Statements are compared with whitespace and quote styles normalised. */
export function normaliseStatement(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// --- plain words ---------------------------------------------------------------------------------------------------

const termWords = (t: string): string =>
  t.startsWith("NET_") ? `net ${t.slice(4)}` : t.toLowerCase().replace(/_/g, " ");

export function describeRule(rule: Rule): string {
  switch (rule.kind) {
    case "auto_max_amount":
      return rule.action === "refund.create"
        ? `Refunds up to ${usd(rule.maxUsd)} per order go through on their own; above ${usd(rule.maxUsd)} they wait for the owner.`
        : `Invoices up to ${usd(rule.maxUsd)} are sent on their own; above ${usd(rule.maxUsd)} they wait for the owner before sending.`;
    case "per_customer_count":
      return `At most ${rule.max} refund${rule.max === 1 ? "" : "s"} per customer in any ${rule.windowDays} days; another one is ${
        rule.over === "block" ? "refused" : "held for the owner"
      }.`;
    case "block_if_open_dispute":
      return "No refund while the order has an open PayPal dispute; it is refused.";
    case "invoice_terms":
      return `Invoices use ${rule.allowedTerms.map(termWords).join(" or ")} terms with at most ${rule.maxDiscountPct}% discount; anything else is ${
        rule.over === "block" ? "refused" : "held for the owner"
      }.`;
  }
}

export function describeLimits(limits: Limits): string[] {
  return canonicalLimits(limits).rules.map(describeRule);
}

export function governsAction(policy: Policy, type: ActionType): boolean {
  return policy.status === "confirmed" && !!policy.limits && policy.limits.governs.includes(type);
}
