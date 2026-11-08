import { PayPalAgentToolkit, ALL_TOOLS_ENABLED } from "@paypal/agent-toolkit/ai-sdk";
import { describe, expect, it } from "vitest";
import { withAlignGuard, type ToolkitTool } from "../src/adapters/ai-sdk";
import { classifyTool, SUPPORT_AGENT_TOOLKIT_ACTIONS, TOOL_TABLE } from "../src/classify";
import { silentLogger } from "../src/paypal/client";
import { BEN, makeGuard, refundFacts } from "./helpers";

const allToolkitTools = () =>
  new PayPalAgentToolkit({
    clientId: "test",
    clientSecret: "test",
    configuration: { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } },
  }).getTools() as unknown as Record<string, ToolkitTool>;

const exec = (t: unknown, input: unknown) =>
  (t as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: "t1", messages: [] });

describe("classification table", () => {
  it("covers every tool of the installed Agent Toolkit", () => {
    const names = Object.keys(allToolkitTools());
    expect(names.length).toBeGreaterThan(40);
    const missing = names.filter((n) => classifyTool(n).class === "unknown");
    expect(missing).toEqual([]);
  });

  it("never exposes the money-moving tools it does not guard", () => {
    for (const n of ["pay_order", "accept_dispute_claim", "create_subscription", "cancel_subscription", "create_order", "update_subscription"]) {
      expect(TOOL_TABLE[n]!.class).toBe("not_exposed");
    }
  });

  it("guards refunds and invoice create, send and cancel", () => {
    expect(classifyTool("refund_order")).toEqual({ class: "guarded", action: "refund.create" });
    expect(classifyTool("create_refund")).toEqual({ class: "guarded", action: "refund.create" });
    expect(classifyTool("create_invoice")).toEqual({ class: "guarded", action: "invoice.create" });
    expect(classifyTool("send_invoice")).toEqual({ class: "guarded", action: "invoice.send" });
    expect(classifyTool("cancel_sent_invoice")).toEqual({ class: "guarded", action: "invoice.cancel" });
  });

  it("treats an unknown tool as unknown", () => {
    expect(classifyTool("create_payout").class).toBe("unknown");
  });
});

describe("withAlignGuard", () => {
  it("drops not-exposed tools, keeps reads, guards money, and adds refund_order", () => {
    const { guard } = makeGuard(refundFacts());
    const tools = withAlignGuard(allToolkitTools(), guard, { log: silentLogger });
    expect(tools.pay_order).toBeUndefined();
    expect(tools.accept_dispute_claim).toBeUndefined();
    expect(tools.get_order).toBeDefined();
    expect(tools.create_invoice).toBeDefined();
    expect(tools.refund_order).toBeDefined();
    expect(tools.create_invoice!.description).toMatch(/ALIGN Pay checks this call/);
  });

  it("the support agent's toolkit configuration yields exactly the tools it needs", () => {
    const tk = new PayPalAgentToolkit({ clientId: "t", clientSecret: "t", configuration: { actions: SUPPORT_AGENT_TOOLKIT_ACTIONS as never, context: { sandbox: true } } });
    const { guard } = makeGuard(refundFacts());
    const tools = withAlignGuard(tk.getTools() as unknown as Record<string, ToolkitTool>, guard, { log: silentLogger });
    expect(Object.keys(tools).sort()).toEqual(
      ["cancel_sent_invoice", "create_invoice", "get_dispute", "get_invoice", "get_order", "get_refund", "list_disputes", "list_invoices", "refund_order", "send_invoice"].sort(),
    );
  });

  it("a guarded call goes through the guard with the session's customer, not the agent's", async () => {
    const { guard, executor, store } = makeGuard(refundFacts({ customerId: BEN }));
    const tools = withAlignGuard({}, guard, { customerId: BEN, log: silentLogger });
    const out = (await exec(tools.refund_order, { order_id: "ORDER0000000000ASHA", amount_usd: 20, reason: "late" })) as Record<string, unknown>;
    expect(out.status).toBe("allowed");
    expect(out.decision_key).toBe("AL-11");
    expect(out.paypal_id).toBe("REFUND1");
    expect(executor.calls).toHaveLength(1);
    expect(store.getAction(out.action_id as string)!.customerId).toBe(BEN);
  });

  it("an id the agent made up never reaches PayPal unchecked", async () => {
    const { guard } = makeGuard(refundFacts());
    const tools = withAlignGuard({}, guard, { log: silentLogger });
    const out = (await exec(tools.refund_order, { order_id: "../../v1/payouts", amount_usd: 1 })) as Record<string, unknown>;
    expect(out.status).not.toBe("allowed");
  });

  it("a tool missing from the table is kept but every call is held", async () => {
    const { guard, executor } = makeGuard(refundFacts());
    const strange: ToolkitTool = { description: "send money", parameters: undefined, execute: (async () => "moved") as never };
    const tools = withAlignGuard({ create_payout: strange }, guard, { log: silentLogger });
    const out = (await exec(tools.create_payout, { amount: 900 })) as Record<string, unknown>;
    expect(out.status).toBe("held");
    expect(executor.calls).toHaveLength(0);
  });
});
