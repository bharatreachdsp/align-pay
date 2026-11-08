import type { Limits } from "@align-agent/paypal-guard";
import { type Browser, type BrowserContext, type Locator, type Page, chromium } from "playwright";
import { matchesRule } from "./content";

/** Drives the running app through its UI, the way a person would. Shared by screenshots, video and the judge run. */
export interface App {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  base: string;
}

export async function openApp(base: string, viewport: { width: number; height: number }, deviceScaleFactor = 1, headless = true): Promise<App> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport, deviceScaleFactor, colorScheme: "light", locale: "en-US", timezoneId: "Asia/Kolkata" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { browser, context, page, base };
}

export async function go(app: App, path: string): Promise<void> {
  await app.page.goto(`${app.base}${path}`, { waitUntil: "networkidle" });
}

/** Clicks "Start a demo" and waits until the orders exist in PayPal. */
export async function startDemo(app: App): Promise<void> {
  await go(app, "/");
  await app.page.getByTestId("start-demo-button").click();
  await app.page.getByTestId("demo-ready").waitFor({ timeout: 120_000 });
}

export async function pickCustomer(app: App, base: "asha" | "ben" | "chen"): Promise<void> {
  if (!app.page.url().endsWith("/support")) await go(app, "/support");
  await app.page.getByTestId(`customer-${base}`).click();
  await app.page.getByTestId("chat").waitFor();
}

/** Types a message as the customer (visible typing for the video) and waits for the guard's receipt card. */
export async function say(app: App, text: string, o: { typeDelay?: number; expect?: string[]; timeout?: number; nth?: number } = {}): Promise<Locator | null> {
  const before = await app.page.getByTestId("receipt-card").count();
  const input = app.page.getByTestId("chat-input");
  await input.click();
  if (o.typeDelay) await input.pressSequentially(text, { delay: o.typeDelay });
  else await input.fill(text);
  await input.press("Enter");
  const want = o.expect ?? ["held", "blocked", "allowed", "denied", "failed"];
  const cards = app.page.getByTestId("receipt-card");
  const deadline = Date.now() + (o.timeout ?? 150_000);
  const need = before + (o.nth ?? 1);
  while (Date.now() < deadline) {
    const n = await cards.count();
    if (n >= need) {
      const last = cards.nth(n - 1);
      const status = await last.getAttribute("data-status");
      if (status && want.includes(status)) {
        await waitForAgentIdle(app);
        return last;
      }
    }
    await app.page.waitForTimeout(500);
  }
  await waitForAgentIdle(app);
  return null;
}

/** Waits until the agent has finished its reply (the Send button is enabled again once the input has text). */
export async function waitForAgentIdle(app: App, timeout = 120_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const busy = await app.page.locator(".suggestions button[disabled]").count();
    if (!busy) return;
    await app.page.waitForTimeout(400);
  }
}

/** The first held card on the owner page, approved with a note. Returns once the guard has executed it. */
export async function approveFirstHold(app: App, note: string, o: { typeDelay?: number; beforeClick?: (card: Locator) => Promise<void> } = {}): Promise<Locator> {
  await go(app, "/owner");
  const card = app.page.getByTestId("holds").getByTestId("receipt-card").first();
  await card.waitFor();
  const actionId = await card.getAttribute("data-action");
  const input = card.getByLabel("Note");
  if (o.typeDelay) await input.pressSequentially(note, { delay: o.typeDelay });
  else await input.fill(note);
  await card.getByTestId("approve").hover();
  if (o.beforeClick) await o.beforeClick(card);
  await card.getByTestId("approve").click();
  return app.page.locator(`[data-testid="receipt-card"][data-action="${actionId}"]`).first();
}

export async function waitForStatus(card: Locator, status: string, timeout = 60_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await card.getAttribute("data-status").catch(() => null)) === status) return;
    await card.page().waitForTimeout(500);
  }
  throw new Error(`card did not reach ${status}`);
}

export async function waitForWebhook(card: Locator, timeout = 120_000): Promise<boolean> {
  try {
    await card.getByTestId("webhook-verified").waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

export interface AppStateLite {
  ledger: { mode: string; label: string; syncing: boolean };
  policies: { decisionKey: string; status: string; statement: string; confirmedBy: string | null; limits: Limits | null }[];
  scenario: { status: string } | null;
  confirmed: number;
}

/**
 * Plays the fictional store owner on the owner page: for each rule not yet confirmed, checks that Gemini's draft says
 * what the rule says, then clicks Confirm. A draft that does not match is never confirmed: this throws instead.
 */
export async function confirmRules(app: App, o: { pause?: number; onEach?: (card: Locator) => Promise<void> } = {}): Promise<string[]> {
  const deadline = Date.now() + 180_000;
  let s = await appState(app.base);
  while ((s.ledger.syncing || s.policies.length < 4 || s.policies.some((p) => !p.limits)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    s = await appState(app.base);
  }
  const wrong = s.policies.filter((p) => p.status !== "confirmed" && !matchesRule(p.statement, p.limits));
  if (wrong.length) throw new Error(`Gemini's draft does not match the rule for ${wrong.map((p) => p.decisionKey).join(", ")}; not confirming.`);
  if (!app.page.url().endsWith("/owner")) await go(app, "/owner");
  const done: string[] = [];
  for (const p of s.policies.filter((x) => x.status !== "confirmed")) {
    const card = app.page.getByTestId(`policy-${p.decisionKey}`);
    await card.scrollIntoViewIfNeeded();
    if (o.onEach) await o.onEach(card);
    await card.getByTestId(`confirm-${p.decisionKey}`).click();
    await app.page.locator(`[data-testid="policy-${p.decisionKey}"][data-status="confirmed"]`).waitFor({ timeout: 20_000 });
    done.push(p.decisionKey);
    if (o.pause) await app.page.waitForTimeout(o.pause);
  }
  return done;
}

export async function appState(base: string): Promise<AppStateLite> {
  return (await (await fetch(`${base}/api/state`)).json()) as AppStateLite;
}
