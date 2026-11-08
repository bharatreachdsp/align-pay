import { ulid } from "ulid";
import { z } from "zod";

/** The money-moving actions ALIGN Pay guards. */
export const ACTION_TYPES = ["refund.create", "invoice.create", "invoice.send", "invoice.cancel"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ActionTypeSchema = z.enum(ACTION_TYPES);

/** PayPal's invoice payment terms (Invoicing v2 `detail.payment_term.term_type`). */
export const TERM_TYPES = [
  "DUE_ON_RECEIPT",
  "DUE_ON_DATE_SPECIFIED",
  "NET_10",
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "NET_90",
  "NO_DUE_DATE",
] as const;
export type TermType = (typeof TERM_TYPES)[number];
export const TermTypeSchema = z.enum(TERM_TYPES);

/**
 * One money-moving tool call, as the guard sees it. `args` is the tool's raw input and is untrusted: the guard reads
 * amounts and ownership from PayPal, never from here. `requested` is what the agent asked for, kept for the receipt.
 */
export interface Action {
  /** "alp_" + ULID. Also the PayPal-Request-Id, so executing twice cannot move money twice. */
  id: string;
  type: ActionType;
  scenarioId?: string;
  requestedBy: "support-agent" | "coding-agent" | string;
  /** The tool name the agent called. */
  tool?: string;
  args: unknown;
  target: { orderId?: string; captureId?: string; invoiceId?: string };
  requested: { amountUsd?: number; discountPct?: number; terms?: string };
  /** The customer the conversation is with, set by the app from the session, never by the agent. */
  customerId?: string;
}

export function newActionId(): string {
  return `alp_${ulid()}`;
}

export const ACTION_ID_PATTERN = /^alp_[0-9A-HJKMNP-TV-Z]{26}$/;

/** PayPal order, capture and invoice ids: letters, digits and dashes only. Anything else never reaches a URL. */
export const PAYPAL_ID_PATTERN = /^[A-Za-z0-9-]{6,64}$/;

export function safePayPalId(v: unknown): string | undefined {
  return typeof v === "string" && PAYPAL_ID_PATTERN.test(v.trim()) ? v.trim() : undefined;
}

/** A USD amount from untrusted input: a finite number with at most two decimals, or undefined. */
export function parseUsd(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100) / 100;
}

export const usd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

export const cents = (n: number): number => Math.round(n * 100);
