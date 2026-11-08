import type { ActionFilter, ActionRecord, Scenario, Store, StoreOrder, WebhookEventRecord } from "./types";
import type { LedgerSnapshot } from "../ledger/types";
import type { Policy } from "../policy";

/** A minimal document backend: collections of JSON documents by id. */
export interface DocBackend {
  get(col: string, id: string): unknown;
  put(col: string, id: string, doc: unknown): void;
  insertIfAbsent(col: string, id: string, doc: unknown): boolean;
  list(col: string): unknown[];
  del(col: string, id: string): void;
  clear(col: string): void;
}

const clone = <T>(v: T): T => (v === null || v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

const byCreated = <T extends { createdAt: string }>(a: T, b: T) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/** The Store on top of any document backend. Lists come back newest first. */
export class DocStore implements Store {
  constructor(private readonly db: DocBackend) {}

  putAction(a: ActionRecord) {
    this.db.put("actions", a.id, a);
  }
  getAction(id: string) {
    return clone((this.db.get("actions", id) as ActionRecord | undefined) ?? null);
  }
  listActions(f: ActionFilter = {}) {
    const statuses = f.status ? (Array.isArray(f.status) ? f.status : [f.status]) : null;
    return (this.db.list("actions") as ActionRecord[])
      .filter(
        (a) =>
          (!statuses || statuses.includes(a.status)) &&
          (!f.customerId || a.customerId === f.customerId || a.paypalCustomerId === f.customerId) &&
          (!f.type || a.type === f.type) &&
          (!f.scenarioId || a.scenarioId === f.scenarioId),
      )
      .map(clone)
      .sort(byCreated);
  }

  putOrder(o: StoreOrder) {
    this.db.put("orders", o.orderId, o);
  }
  getOrder(orderId: string) {
    return clone((this.db.get("orders", orderId) as StoreOrder | undefined) ?? null);
  }
  listOrders(f: { customerId?: string; scenarioId?: string } = {}) {
    return (this.db.list("orders") as StoreOrder[])
      .filter((o) => (!f.customerId || o.customerId === f.customerId) && (!f.scenarioId || o.scenarioId === f.scenarioId))
      .map(clone)
      .sort(byCreated);
  }

  putPolicy(p: Policy) {
    this.db.put("policies", p.decisionKey, p);
  }
  getPolicy(key: string) {
    return clone((this.db.get("policies", key) as Policy | undefined) ?? null);
  }
  listPolicies() {
    return (this.db.list("policies") as Policy[]).map(clone).sort((a, b) => a.decisionKey.localeCompare(b.decisionKey, "en", { numeric: true }));
  }
  deletePolicy(key: string) {
    this.db.del("policies", key);
  }

  putLedgerSnapshot(s: LedgerSnapshot) {
    this.db.put("kv", "ledger_snapshot", s);
  }
  clearLedgerSnapshot() {
    this.db.del("kv", "ledger_snapshot");
  }
  getLedgerSnapshot() {
    return clone((this.db.get("kv", "ledger_snapshot") as LedgerSnapshot | undefined) ?? null);
  }

  addWebhookEvent(e: WebhookEventRecord) {
    return this.db.insertIfAbsent("webhook_events", e.id, e);
  }
  listWebhookEvents() {
    return (this.db.list("webhook_events") as WebhookEventRecord[])
      .map(clone)
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }

  putScenario(s: Scenario) {
    this.db.put("scenarios", s.id, s);
  }
  getScenario(id: string) {
    return clone((this.db.get("scenarios", id) as Scenario | undefined) ?? null);
  }
  listScenarios() {
    return (this.db.list("scenarios") as Scenario[]).map(clone).sort(byCreated);
  }

  getKv<T = unknown>(key: string): T | null {
    return clone((this.db.get("kv", key) as T | undefined) ?? null);
  }
  setKv(key: string, value: unknown) {
    this.db.put("kv", key, value);
  }

  /**
   * Starts the demo over: open holds, refusals and scenarios go. Money that moved in PayPal stays on the record
   * (executed actions, orders, webhook events), so the audit can still trace it.
   */
  resetDemo() {
    for (const a of this.db.list("actions") as ActionRecord[]) {
      if (a.status !== "executed" && a.status !== "failed") this.db.del("actions", a.id);
    }
    this.db.clear("scenarios");
    this.db.del("kv", "last_audit");
  }
}
