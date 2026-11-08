import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  AlignMcpLedger,
  type ConfirmedLimitsFile,
  ConfirmedLimitsFileSchema,
  FixturesLedger,
  Guard,
  type LedgerPreference,
  type Logger,
  ModelDrafter,
  PayPalClient,
  PayPalExecutor,
  PayPalFacts,
  STORE_RULE_STATEMENTS,
  type Store,
  type SyncReport,
  assertSandboxEnv,
  consoleLogger,
  kettleAndKesar,
  storePolicySource,
  syncLedger,
  syncPolicies,
} from "@align-agent/paypal-guard";
import { loadEnvFiles } from "@align-agent/paypal-guard/env";
import { sqliteStore } from "@align-agent/paypal-guard/store/sqlite";
import { generateText, type LanguageModel } from "ai";

/** The repository root: set by `pnpm demo`, else two levels above apps/web. */
export const REPO_ROOT = process.env.ALIGN_PAY_ROOT ?? resolve(process.cwd(), process.cwd().endsWith(join("apps", "web")) ? "../.." : ".");
loadEnvFiles(REPO_ROOT);
export const DATA_DIR = process.env.ALIGN_PAY_DATA_DIR ?? join(REPO_ROOT, ".data");

/** Gemini models. The Pro model runs the support agent and drafts limits; Flash writes one-line explanations. */
export const PRO_MODEL = process.env.GEMINI_PRO_MODEL ?? "gemini-2.5-pro";
export const FLASH_MODEL = process.env.GEMINI_FLASH_MODEL ?? "gemini-2.5-flash";

const log: Logger = consoleLogger;

export interface LedgerStatus {
  syncing: boolean;
  reason: string | null;
  lastSyncAt: string | null;
  mismatches: string[];
  preference: LedgerPreference;
}

export interface Runtime {
  store: Store;
  paypal: PayPalClient;
  guard: Guard;
  facts: PayPalFacts;
  directory: ReturnType<typeof kettleAndKesar>;
  pro: LanguageModel | null;
  flash: LanguageModel | null;
  ledger: LedgerStatus;
  confirmations: ConfirmedLimitsFile | null;
  syncLedgerNow(): Promise<SyncReport | null>;
  ready: Promise<void>;
  log: Logger;
}

function readConfirmations(): ConfirmedLimitsFile | null {
  const file = join(DATA_DIR, "owner-confirmed-limits.json");
  if (!existsSync(/*turbopackIgnore: true*/ file)) return null;
  try {
    return ConfirmedLimitsFileSchema.parse(JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
  } catch (e) {
    log.warn("owner-confirmed-limits.json did not parse; nothing is confirmed from it", { error: (e as Error).message.slice(0, 120) });
    return null;
  }
}

function create(): Runtime {
  assertSandboxEnv();
  const store = sqliteStore(join(DATA_DIR, "align-pay.db"));
  const paypal = new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    log,
  });
  const directory = kettleAndKesar();
  const facts = new PayPalFacts({ paypal, store, directory, log });
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const google = key ? createGoogleGenerativeAI({ apiKey: key }) : null;
  const pro = google ? google(PRO_MODEL) : null;
  const flash = google ? google(FLASH_MODEL) : null;

  const ledger: LedgerStatus = {
    syncing: false,
    reason: null,
    lastSyncAt: null,
    mismatches: [],
    preference: (process.env.ALIGN_PAY_LEDGER as LedgerPreference) || "auto",
  };

  const guard = new Guard({
    store,
    facts,
    executor: new PayPalExecutor(paypal),
    policies: storePolicySource(store, () => ledger.reason),
    directory,
    log,
    explain: flash
      ? async (rec) => {
          const { text } = await generateText({
            model: flash,
            system:
              "You write one short, plain sentence for a customer-support receipt card that explains why a payment action was held for the store owner or refused. Use only the facts given. No greeting, no promises, under 25 words.",
            prompt: JSON.stringify({ outcome: rec.status, reason: rec.verdict.reason, rule: rec.verdict.results.find((r) => r.outcome !== "allow")?.statement ?? null }),
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(3000),
          });
          return text.trim();
        }
      : undefined,
  });

  let inFlight: Promise<SyncReport | null> | null = null;
  const rt: Runtime = {
    store,
    paypal,
    guard,
    facts,
    directory,
    pro,
    flash,
    ledger,
    confirmations: readConfirmations(),
    log,
    ready: Promise.resolve(),
    syncLedgerNow() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        ledger.syncing = true;
        try {
          rt.confirmations = readConfirmations();
          const state = await syncLedger({
            preference: ledger.preference,
            align:
              ledger.preference === "fixtures"
                ? null
                : new AlignMcpLedger({
                    cli: process.env.ALIGN_CLI ?? "npx -y @align-agent/cli@0.1.7",
                    repoDir: REPO_ROOT,
                    statements: STORE_RULE_STATEMENTS,
                  }),
            fixtures: new FixturesLedger(join(REPO_ROOT, "ledger", "fixtures.json")),
            store,
            log,
          });
          ledger.reason = state.reason;
          ledger.lastSyncAt = new Date().toISOString();
          if (!state.snapshot) return null;
          const report = await syncPolicies({
            snapshot: state.snapshot,
            store,
            drafter: pro ? new ModelDrafter(pro, PRO_MODEL) : null,
            confirmations: rt.confirmations,
            log,
          });
          ledger.mismatches = report.mismatches;
          return report;
        } catch (e) {
          ledger.reason = `Sync failed: ${(e as Error).message.slice(0, 160)}`;
          log.error("ledger sync failed", { error: ledger.reason });
          return null;
        } finally {
          ledger.syncing = false;
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
  rt.ready = rt.syncLedgerNow().then(() => undefined);
  return rt;
}

const g = globalThis as unknown as { __alignPay?: Runtime };

/** One runtime per server process. */
export function runtime(): Runtime {
  if (!g.__alignPay) g.__alignPay = create();
  return g.__alignPay;
}
