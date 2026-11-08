import { type ToolSet, asSchema, jsonSchema, tool } from "ai";
import { z } from "zod";
import { type Action, type ActionType, TERM_TYPES, newActionId, parseUsd, safePayPalId } from "../actions";
import { classifyTool } from "../classify";
import type { Guard, GuardResult } from "../guard";
import { type Logger, consoleLogger } from "../paypal/client";

/** The shape of a tool from @paypal/agent-toolkit's AI SDK adapter (built for AI SDK 4: `parameters`, zod 3). */
export interface ToolkitTool {
  description?: string;
  parameters?: unknown;
  inputSchema?: unknown;
  execute?: (args: never, options?: unknown) => unknown;
}

export interface GuardContext {
  /** The customer the conversation is with, from the session. The agent cannot change it. */
  customerId?: string;
  scenarioId?: string;
  requestedBy?: string;
  log?: Logger;
}

/** What a guarded tool returns to the model. */
export interface GuardedToolOutput {
  status: GuardResult["status"];
  decision_key: string | null;
  reason: string;
  paypal_id?: string;
  action_id: string;
  next_step?: string;
}

const GUARD_NOTE =
  " ALIGN Pay checks this call against the store owner's confirmed decisions using PayPal's own records. The result says allowed, held (waiting for the owner) or blocked, with the decision key; report it to the customer as it is.";

export const RefundOrderInput = z.object({
  order_id: z.string().describe("The PayPal order id of the customer's order, from list_customer_orders."),
  amount_usd: z
    .number()
    .positive()
    .optional()
    .describe("The refund amount in US dollars. Omit it to refund what is left on the order."),
  reason: z.string().max(300).optional().describe("Why the customer asked, in a few words."),
});

/** ALIGN Pay's own refund tool: refunds a customer's order through the guard. */
export const REFUND_ORDER_DESCRIPTION =
  "Refund all or part of a customer's order in PayPal. Use the order id from list_customer_orders." + GUARD_NOTE;

function toAction(name: string, type: ActionType, input: Record<string, unknown>, ctx: GuardContext): Action {
  const base = {
    id: newActionId(),
    type,
    tool: name,
    args: input,
    requestedBy: ctx.requestedBy ?? "support-agent",
    ...(ctx.customerId ? { customerId: ctx.customerId } : {}),
    ...(ctx.scenarioId ? { scenarioId: ctx.scenarioId } : {}),
  };
  switch (type) {
    case "refund.create": {
      const amount =
        parseUsd(input.amount_usd) ?? parseUsd((input.amount as { value?: unknown } | undefined)?.value) ?? undefined;
      const orderId = safePayPalId(input.order_id);
      const captureId = safePayPalId(input.capture_id);
      return {
        ...base,
        target: { ...(orderId ? { orderId } : {}), ...(captureId ? { captureId } : {}) },
        requested: amount !== undefined ? { amountUsd: amount } : {},
      };
    }
    case "invoice.create": {
      const items = Array.isArray(input.items) ? (input.items as { discount?: { percent?: unknown } }[]) : [];
      const pct = Number(input.discount_percent ?? items.find((i) => i.discount?.percent !== undefined)?.discount?.percent ?? 0);
      const terms = typeof input.payment_term === "string" ? input.payment_term : undefined;
      return {
        ...base,
        target: {},
        requested: { ...(Number.isFinite(pct) ? { discountPct: pct } : {}), ...(terms ? { terms } : {}) },
      };
    }
    default: {
      const invoiceId = safePayPalId(input.invoice_id);
      return { ...base, target: invoiceId ? { invoiceId } : {}, requested: {} };
    }
  }
}

const toOutput = (r: GuardResult): GuardedToolOutput => ({
  status: r.status,
  decision_key: r.key,
  reason: r.reason,
  ...(r.paypalId ? { paypal_id: r.paypalId } : {}),
  action_id: r.actionId,
  ...(r.alternative ? { next_step: r.alternative } : {}),
});

/** The toolkit's create_invoice has no payment terms field; ALIGN Pay adds one, because the store's rule is about terms. */
function invoiceSchemaWithTerms(params: unknown) {
  return jsonSchema(async () => {
    const js = (await asSchema(params as never).jsonSchema) as { properties?: Record<string, unknown>; [k: string]: unknown };
    return {
      ...js,
      properties: {
        ...(js.properties ?? {}),
        payment_term: {
          type: "string",
          enum: [...TERM_TYPES],
          description: "PayPal payment terms for the invoice, e.g. NET_15 for net 15 or NET_30 for net 30. Omit for due on receipt.",
        },
      },
    } as never;
  });
}

/**
 * Wraps a toolset for the AI SDK so every money-moving call goes through the guard:
 *
 * - read tools call PayPal (through the toolkit) and are logged;
 * - guarded tools become Actions and call `guard.handle`, returning {status, decision_key, reason, paypal_id?};
 * - tools that move money but are not guarded are dropped;
 * - tools missing from the classification table are kept, but every call is held for the owner.
 *
 * ALIGN Pay's own `refund_order` tool is always added.
 */
export function withAlignGuard(tools: Record<string, ToolkitTool>, guard: Guard, ctx: GuardContext = {}): ToolSet {
  const log = ctx.log ?? consoleLogger;
  const out: ToolSet = {};

  out.refund_order = tool({
    description: REFUND_ORDER_DESCRIPTION,
    inputSchema: RefundOrderInput,
    execute: async (input) => toOutput(await guard.handle(toAction("refund_order", "refund.create", input, ctx))),
  });

  for (const [name, t] of Object.entries(tools)) {
    if (name === "refund_order") continue;
    const c = classifyTool(name);
    const params = t.parameters ?? t.inputSchema;
    if (c.class === "not_exposed") continue;
    if (c.class === "read") {
      out[name] = tool({
        description: t.description ?? name,
        inputSchema: asSchema(params as never),
        execute: async (input: unknown) => {
          log.info("read tool", { tool: name });
          try {
            return await (t.execute as (a: unknown, o: unknown) => Promise<unknown>)(input, { toolCallId: name, messages: [] });
          } catch (e) {
            log.warn("read tool failed", { tool: name, error: (e as Error).message.slice(0, 160) });
            return { error: "PayPal did not answer this lookup." };
          }
        },
      });
      continue;
    }
    if (c.class === "guarded") {
      out[name] = tool({
        description: (t.description ?? name).trim() + GUARD_NOTE,
        inputSchema: name === "create_invoice" ? invoiceSchemaWithTerms(params) : asSchema(params as never),
        execute: async (input: unknown) =>
          toOutput(await guard.handle(toAction(name, c.action, (input ?? {}) as Record<string, unknown>, ctx))),
      });
      continue;
    }
    log.warn("tool is not in ALIGN Pay's classification table; every call to it will be held", { tool: name });
    out[name] = tool({
      description: t.description ?? name,
      inputSchema: asSchema(params as never),
      execute: async (input: unknown) => toOutput(await guard.handleUnknownTool(name, input, ctx)),
    });
  }
  return out;
}
