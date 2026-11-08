import type { Action, ActionType } from "../actions";
import type { Verdict } from "../engine";
import type { LedgerSnapshot } from "../ledger/types";
import type { InvoiceDraft } from "../paypal/invoices";
import type { Policy } from "../policy";

export type ActionStatus = "executing" | "executed" | "held" | "blocked" | "denied" | "failed";

export interface ActionRecord extends Omit<Action, "type"> {
  /** "unknown" is a call to a tool missing from the classification table: always held. */
  type: ActionType | "unknown";
  status: ActionStatus;
  verdict: Verdict;
  /** The verdict when the action first arrived (a held action is evaluated again on approval). */
  firstVerdict: Verdict;
  decisionKey: string | null;
  createdAt: string;
  updatedAt: string;
  /** From PayPal's facts, not the agent: the order, capture, amount and customer this action touched. */
  orderId?: string;
  captureId?: string;
  invoiceId?: string;
  amountUsd?: number;
  paypalCustomerId?: string;
  invoiceDraft?: InvoiceDraft;
  /** The PayPal object created or changed: refund id or invoice id. */
  paypalId?: string;
  paypalStatus?: string;
  executedAt?: string;
  approver?: string;
  approverNote?: string;
  decidedAt?: string;
  /** One plain sentence for held and blocked cards (Gemini Flash, or the deterministic fallback). */
  explanation?: string;
  alternative?: string;
  webhookVerifiedAt?: string;
  webhookEventId?: string;
  error?: string;
}

export interface StoreOrder {
  orderId: string;
  captureId: string | null;
  customerId: string;
  scenarioId?: string;
  items: { sku: string; name: string; quantity: number; unitUsd: number }[];
  totalUsd: number;
  createdAt: string;
  source: "scenario" | "store" | "seed";
  label?: string;
  webhookVerifiedAt?: string;
}

export interface WebhookEventRecord {
  id: string;
  eventType: string;
  resourceId: string | null;
  receivedAt: string;
  createTime: string | null;
  summary: string | null;
  /** What it reconciled against: an action id, an order id, or nothing. */
  matched: string | null;
}

export interface Scenario {
  id: string;
  tag: string;
  createdAt: string;
  customers: Record<string, string>;
  orders: Record<string, string>;
  status: "running" | "ready" | "failed";
  error?: string;
}

export interface ActionFilter {
  status?: ActionStatus | ActionStatus[];
  customerId?: string;
  type?: ActionType | "unknown";
  scenarioId?: string;
}

/** Everything ALIGN Pay keeps locally. Two backends: SQLite for the app, memory for tests. */
export interface Store {
  putAction(a: ActionRecord): void;
  getAction(id: string): ActionRecord | null;
  listActions(f?: ActionFilter): ActionRecord[];

  putOrder(o: StoreOrder): void;
  getOrder(orderId: string): StoreOrder | null;
  listOrders(f?: { customerId?: string; scenarioId?: string }): StoreOrder[];

  putPolicy(p: Policy): void;
  getPolicy(key: string): Policy | null;
  listPolicies(): Policy[];
  deletePolicy(key: string): void;

  putLedgerSnapshot(s: LedgerSnapshot): void;
  getLedgerSnapshot(): LedgerSnapshot | null;

  /** False if the event id was already recorded (webhooks are reconciled once). */
  addWebhookEvent(e: WebhookEventRecord): boolean;
  listWebhookEvents(): WebhookEventRecord[];

  putScenario(s: Scenario): void;
  getScenario(id: string): Scenario | null;
  listScenarios(): Scenario[];

  getKv<T = unknown>(key: string): T | null;
  setKv(key: string, value: unknown): void;

  /** "Reset": clears actions, orders, scenarios and webhook events. Policies, the ledger cache and settings stay. */
  resetDemo(): void;
}
