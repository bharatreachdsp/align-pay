import { describe, expect, it } from "vitest";
import type { Draft, DraftInput, Drafter } from "../src/drafting";
import { normaliseDraft } from "../src/drafting";
import type { LedgerSnapshot } from "../src/ledger/types";
import { STORE_RULE_STATEMENTS } from "../src/ledger/types";
import { canonicalJson, ConfirmedLimitsFileSchema, describeLimits, type Limits, limitsEqual } from "../src/policy";
import { confirmPolicy, SETUP_CONFIRMER, storePolicySource, syncPolicies } from "../src/policies";
import { memoryStore } from "../src/store/memory";
import { CONFIRMED, SETUP_FILE } from "./helpers";

const snapshot = (revision = 1, keys = ["AL-11", "AL-12", "AL-13", "AL-14"]): LedgerSnapshot => ({
  mode: "align",
  syncedAt: "2026-11-08T07:00:00.000Z",
  source: "test",
  decisions: STORE_RULE_STATEMENTS.map((statement, i) => ({
    key: keys[i]!,
    statement,
    status: "confirmed",
    revision,
    why: null,
    receipts: [{ quote: statement, source: "ALIGN · confirmation" }],
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

  it("the setup file's format parses", () => {
    expect(ConfirmedLimitsFileSchema.parse(SETUP_FILE).policies).toHaveLength(4);
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

describe("confirmation matching against the setup file", () => {
  it("an equal draft is confirmed: store owner, during setup", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: SETUP_FILE });
    expect(r.mismatches).toEqual([]);
    expect(r.policies.every((p) => p.status === "confirmed")).toBe(true);
    expect(r.policies[0]!.confirmedBy).toBe(SETUP_CONFIRMER);
    expect(r.policies[0]!.confirmedAt).toBe(SETUP_FILE.confirmedAt);
    expect(r.policies[0]!.confirmMethod).toBe("setup");
    expect(drafter.calls).toHaveLength(4);
  });

  it("a differing draft is re-drafted once with the confirmed limits as a hint", async () => {
    const store = memoryStore();
    const wrong: Limits = { version: 1, governs: ["refund.create"], rules: [{ kind: "auto_max_amount", action: "refund.create", maxUsd: 500, above: "hold" }] };
    const drafter = new ScriptedDrafter((i, n) => (indexOf(i.statement) === 0 && n === 1 ? wrong : CONFIRMED[indexOf(i.statement)]!));
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: SETUP_FILE });
    expect(r.mismatches).toEqual([]);
    expect(r.policies[0]!.status).toBe("confirmed");
    const hinted = drafter.calls.filter((c) => c.hint);
    expect(hinted).toHaveLength(1);
    expect(limitsEqual(hinted[0]!.hint!, CONFIRMED[0]!)).toBe(true);
  });

  it("a draft that still differs stays a draft, is not enforced, and is reported", async () => {
    const store = memoryStore();
    const wrong: Limits = { version: 1, governs: ["refund.create"], rules: [{ kind: "auto_max_amount", action: "refund.create", maxUsd: 500, above: "hold" }] };
    const drafter = new ScriptedDrafter((i) => (indexOf(i.statement) === 0 ? wrong : CONFIRMED[indexOf(i.statement)]!));
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: SETUP_FILE });
    expect(r.mismatches).toEqual(["AL-11"]);
    expect(r.policies[0]!.status).toBe("draft");
    store.putLedgerSnapshot(snapshot());
    const src = await storePolicySource(store, () => null).current();
    expect(src.policies.filter((p) => p.status === "confirmed").map((p) => p.decisionKey)).toEqual(["AL-12", "AL-13", "AL-14"]);
  });

  it("without a setup file nothing is confirmed automatically", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: null });
    expect(r.policies.every((p) => p.status === "draft")).toBe(true);
  });

  it("drafting is not repeated once a decision has limits", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: SETUP_FILE });
    await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: SETUP_FILE });
    expect(drafter.calls).toHaveLength(4);
  });

  it("a decision whose revision changed in ALIGN goes back to draft and is drafted again", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    await syncPolicies({ snapshot: snapshot(1), store, drafter, confirmations: null });
    confirmPolicy(store, "AL-11", CONFIRMED[0], "store owner");
    expect(store.getPolicy("AL-11")!.status).toBe("confirmed");
    const r = await syncPolicies({ snapshot: snapshot(2), store, drafter, confirmations: null });
    const p = r.policies.find((x) => x.decisionKey === "AL-11")!;
    expect(p.status).toBe("draft");
    expect(p.note).toMatch(/revision 1 → 2/);
    expect(drafter.calls).toHaveLength(8);
  });

  it("drafting failures leave the policy a draft (fail closed)", async () => {
    const store = memoryStore();
    const drafter: Drafter = { draft: async () => Promise.reject(new Error("model unavailable")) };
    const r = await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: SETUP_FILE });
    expect(r.policies.every((p) => p.status === "draft" && p.limits === null)).toBe(true);
    expect(r.policies[0]!.note).toMatch(/Drafting failed/);
  });

  it("the owner page confirms with edited numbers, marked with who did it", async () => {
    const store = memoryStore();
    const drafter = new ScriptedDrafter((i) => CONFIRMED[indexOf(i.statement)]!);
    await syncPolicies({ snapshot: snapshot(), store, drafter, confirmations: null });
    const edited = structuredClone(CONFIRMED[0]!) as Limits;
    (edited.rules[0] as { maxUsd: number }).maxUsd = 75;
    const p = confirmPolicy(store, "AL-11", edited, "local user");
    expect(p.status).toBe("confirmed");
    expect(p.confirmedBy).toBe("local user");
    expect(p.note).toMatch(/edited/);
    expect(() => confirmPolicy(store, "AL-12", { version: 1, governs: [], rules: [] }, "local user")).toThrow();
  });
});
