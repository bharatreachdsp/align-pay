import { describe, expect, it } from "vitest";
import type { Draft, DraftInput, Drafter } from "../src/drafting";
import { normaliseDraft } from "../src/drafting";
import type { LedgerSnapshot } from "../src/ledger/types";
import { STORE_RULE_STATEMENTS } from "../src/ledger/types";
import { SampleLedger } from "../src/ledger/sample";
import { canonicalJson, describeLimits, type Limits, limitsEqual } from "../src/policy";
import { confirmPolicy, OWNER, storePolicySource, syncPolicies, withdrawPolicy } from "../src/policies";
import { memoryStore } from "../src/store/memory";
import { CONFIRMED } from "./helpers";

const snapshot = (revision = 1, keys = ["AL-11", "AL-12", "AL-13", "AL-14"]): LedgerSnapshot => ({
  mode: "sample",
  syncedAt: "2026-11-08T07:00:00.000Z",
  source: "test",
  decisions: STORE_RULE_STATEMENTS.map((statement, i) => ({
    key: keys[i]!,
    statement,
    status: "confirmed",
    revision,
    why: null,
    receipts: [{ quote: statement, source: "Sample ALIGN ledger · confirmation" }],
    confirmedBy: "Prateek",
    confirmedAt: null,
  })),
});

/** A drafter that answers from a script: per statement, a queue of limits. */
class ScriptedDrafter implements Drafter {
  calls: DraftInput[] = [];
  constructor(private readonly answer: (input: DraftInput, n: number) => Limits) {}
  async draft(input: DraftInput): Promise<Draft> {
    this.calls.push(input);
    const n = this.calls.filter((c) => c.statement === input.statement).length;
    return { limits: this.answer(input, n), reading: "test reading", model: "test-model" };
  }
}

const indexOf = (s: string) => STORE_RULE_STATEMENTS.indexOf(s as never);

describe("canonical limits", () => {
  it("ignore key order, governs order and rule order", () => {
    const a: Limits = CONFIRMED[3]!;
    const b = {
      rules: [
        { maxUsd: 2000, above: "hold", action: "invoice.send", kind: "auto_max_amount" },
        { over: "block", maxDiscountPct: 10, allowedTerms: ["NET_15"], kind: "invoice_terms" },
      ],
      governs: ["invoice.send", "invoice.create"],
      version: 1,
    } as unknown as Limits;
    expect(limitsEqual(a, b)).toBe(true);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("differ when a number differs", () => {
    const c = structuredClone(CONFIRMED[0]!) as Limits;
    (c.rules[0] as { maxUsd: number }).maxUsd = 500;
    expect(limitsEqual(CONFIRMED[0]!, c)).toBe(false);
  });

  it("read in plain words", () => {
    expect(describeLimits(CONFIRMED[0]!)[0]).toMatch(/up to \$50 per order/);
    expect(describeLimits(CONFIRMED[3]!).join(" ")).toMatch(/net 15/);
  });

  it("the Sample ALIGN ledger parses against ALIGN's own entry schema", async () => {
    const snap = await new SampleLedger(new URL("../../../ledger/sample-ledger.json", import.meta.url).pathname).sync();
    expect(snap.mode).toBe("sample");
    expect(snap.decisions.map((d) => d.key)).toEqual(["AL-1", "AL-2", "AL-3", "AL-4"]);
    expect(snap.decisions.map((d) => d.statement)).toEqual([...STORE_RULE_STATEMENTS]);
    expect(snap.decisions.every((d) => d.receipts[0]!.quote === d.statement && d.receipts[0]!.source === "Sample ALIGN ledger · confirmation")).toBe(true);
    expect(snap.decisions[0]!.confirmedBy).toBe("Store owner (Kettle & Kesar)");
  });
});

describe("drafts from the model", () => {
  it("are normalised into strict limits", () => {
    const l = normaliseDraft({
      governs: ["invoice.create", "invoice.send"],
      reading: "x",
      rules: [
        { kind: "invoice_terms", action: null, maxUsd: null, max: null, windowDays: null, over: "block", allowedTerms: ["NET_15"], maxDiscountPct: 10 },
        { kind: "auto_max_amount", action: "invoice.send", maxUsd: 2000, max: null, windowDays: null, over: null, allowedTerms: null, maxDiscountPct: null },
      ],
    });
    expect(limitsEqual(l, CONFIRMED[3]!)).toBe(true);
  });

  it("missing numbers are rejected, never guessed", () => {
    expect(() =>
      normaliseDraft({
        governs: ["refund.create"],
        reading: "x",
        rules: [{ kind: "auto_max_amount", action: "refund.create", maxUsd: null, max: null, windowDays: null, over: null, allowedTerms: null, maxDiscountPct: null }],
      }),
    ).toThrow();
  });
});

describe("drafting and confirmation", () => {
  it("drafts every decision and confirms none of them: only the owner's Confirm click does", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter });
    expect(drafter.calls).toHaveLength(4);
    expect(r.policies.every((p) => p.status === "draft" && p.limits !== null)).toBe(true);
    store.putLedgerSnapshot(snapshot());
    const src = await storePolicySource(store, () => null).current();
    expect(src.policies.filter((p) => p.status === "confirmed")).toHaveLength(0);
  });

  it("the owner confirms on the owner page, shown as confirmed by the store owner", async () => {
    const store = memoryStore();
    await syncPolicies({ snapshot: snapshot(), store, drafter: new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!) });
    const p = confirmPolicy(store, "AL-11", store.getPolicy("AL-11")!.limits);
    expect(p.status).toBe("confirmed");
    expect(p.confirmedBy).toBe(OWNER);
    expect(p.confirmMethod).toBe("owner page");
    expect(p.note).toBeNull();
  });

  it("drafting is not repeated, and confirmations survive a re-sync", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    await syncPolicies({ snapshot: snapshot(), store, drafter });
    confirmPolicy(store, "AL-12", store.getPolicy("AL-12")!.limits);
    await syncPolicies({ snapshot: snapshot(), store, drafter });
    expect(drafter.calls).toHaveLength(4);
    expect(store.getPolicy("AL-12")!.status).toBe("confirmed");
  });

  it("a decision whose revision changed goes back to draft and is drafted again", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    await syncPolicies({ snapshot: snapshot(1), store, drafter });
    confirmPolicy(store, "AL-11", CONFIRMED[0]);
    expect(store.getPolicy("AL-11")!.status).toBe("confirmed");
    const r = await syncPolicies({ snapshot: snapshot(2), store, drafter });
    const p = r.policies.find((x) => x.decisionKey === "AL-11")!;
    expect(p.status).toBe("draft");
    expect(p.note).toMatch(/revision 1 → 2/);
    expect(drafter.calls).toHaveLength(8);
  });

  it("drafting failures leave the policy a draft with nothing to confirm (fail closed)", async () => {
    const store = memoryStore();
    const drafter: Drafter = { draft: async () => Promise.reject(new Error("model unavailable")) };
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter });
    expect(r.policies.every((p) => p.status === "draft" && p.limits === null)).toBe(true);
    expect(r.policies[0]!.note).toMatch(/Drafting failed/);
  });

  it("the owner can edit the numbers before confirming; invalid limits are refused", async () => {
    const store = memoryStore();
    await syncPolicies({ snapshot: snapshot(), store, drafter: new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!) });
    const edited = structuredClone(CONFIRMED[0]!) as Limits;
    (edited.rules[0] as { maxUsd: number }).maxUsd = 75;
    const p = confirmPolicy(store, "AL-11", edited);
    expect(p.status).toBe("confirmed");
    expect(p.note).toMatch(/edited the numbers/);
    expect(() => confirmPolicy(store, "AL-12", { version: 1, governs: [], rules: [] })).toThrow();
  });

  it("withdrawing a confirmation stops enforcement", async () => {
    const store = memoryStore();
    await syncPolicies({ snapshot: snapshot(), store, drafter: new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!) });
    confirmPolicy(store, "AL-11", store.getPolicy("AL-11")!.limits);
    const w = withdrawPolicy(store, "AL-11");
    expect(w.status).toBe("draft");
    expect(w.confirmedBy).toBeNull();
    expect(w.limits).not.toBeNull();
  });
});
