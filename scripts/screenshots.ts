/**
 * `pnpm screenshots`: the gallery (submission/gallery/01…07), at 1500×1000 with deviceScaleFactor 2 (3:2), plus one
 * 390 px screenshot of /support. Runs the real flow against the running app (pnpm demo) and the PayPal sandbox.
 *   --allow-fixtures   capture even if the ledger is not ALIGN (the brief wants ALIGN mode)
 */
import { mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, loadEnv } from "./lib/env";
import { type App, appState, approveFirstHold, go, openApp, pickCustomer, say, startDemo, waitForStatus, waitForWebhook } from "./lib/flow";

loadEnv();
const BASE = process.env.ALIGN_PAY_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const OUT = join(REPO_ROOT, "submission", "gallery");
mkdirSync(OUT, { recursive: true });

const state = await appState(BASE);
if (state.ledger.mode !== "align" && !process.argv.includes("--allow-fixtures")) {
  console.error(`The gallery is captured in ALIGN mode, but the app says: ${state.ledger.label}. Use --allow-fixtures to capture anyway.`);
  process.exit(2);
}
if (state.policies.filter((p) => p.status === "confirmed").length < 4) {
  console.error("Confirm the four policies first.");
  process.exit(2);
}

const MAX = 5 * 1024 * 1024;
/** PNG, or JPG if the PNG is 5 MB or more. */
async function shot(app: App, name: string, o: { clip?: { x: number; y: number; width: number; height: number }; fullPage?: false } = {}) {
  const png = join(OUT, `${name}.png`);
  await app.page.screenshot({ path: png, ...(o.clip ? { clip: o.clip } : {}) });
  if (statSync(png).size >= MAX) {
    const jpg = join(OUT, `${name}.jpg`);
    await app.page.screenshot({ path: jpg, type: "jpeg", quality: 88, ...(o.clip ? { clip: o.clip } : {}) });
    unlinkSync(png);
    console.log(`  ${name}.jpg (${(statSync(jpg).size / 1e6).toFixed(1)} MB)`);
  } else console.log(`  ${name}.png (${(statSync(png).size / 1e6).toFixed(1)} MB)`);
}

/** Scrolls so `el` sits a little below the top of the viewport. */
async function bringIntoView(app: App, selector: string, offset = 140) {
  await app.page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel as string);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (off as number), behavior: "instant" as ScrollBehavior });
    },
    [selector, offset],
  );
  await app.page.waitForTimeout(300);
}

const app = await openApp(BASE, { width: 1500, height: 1000 }, 2);
try {
  console.log("Starting a fresh demo…");
  await startDemo(app);

  // 01: Asha's refund held, with its receipt card.
  await pickCustomer(app, "asha");
  const held = await say(app, "My chai case arrived damaged, please refund the $180.", { expect: ["held"] });
  if (!held) throw new Error("Asha's refund was not held");
  await held.scrollIntoViewIfNeeded();
  await app.page.locator(".chat .log").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await app.page.waitForTimeout(600);
  await shot(app, "01-asha-refund-held");

  // 02: the owner approving it.
  await approveFirstHold(app, "Photo shows the case crushed in transit.", {
    beforeClick: async (c) => {
      await c.scrollIntoViewIfNeeded();
      await app.page.waitForTimeout(300);
      await shot(app, "02-owner-approves");
    },
  });

  // 03: the executed refund with its PayPal id and "webhook verified".
  await go(app, "/owner");
  const decided = app.page.getByTestId("receipt-card").filter({ has: app.page.getByTestId("paypal-id") }).first();
  await waitForStatus(decided, "allowed", 90_000);
  const verified = await waitForWebhook(decided, 150_000);
  if (!verified) console.warn("  ! no webhook yet; 03 shows the refund without the webhook line");
  await pickCustomer(app, "asha");
  await app.page.locator(".chat .log").evaluate((el) => (el.scrollTop = el.scrollHeight));
  const supportCard = app.page.getByTestId("receipt-card").last();
  await waitForStatus(supportCard, "allowed", 30_000);
  if (verified) await waitForWebhook(supportCard, 30_000);
  await app.page.waitForTimeout(600);
  await shot(app, "03-refund-executed-webhook-verified");

  // Ben, for the audit and the video's story.
  await pickCustomer(app, "ben");
  await say(app, "Please refund my $40 order too.", { expect: ["blocked"] });

  // 04: the audit, with the outside refund untraced.
  await go(app, "/audit");
  await app.page.getByTestId("run-audit").click();
  await app.page.getByTestId("audit-table").waitFor({ timeout: 120_000 });
  await app.page.waitForTimeout(800);
  const untraced = app.page.locator('[data-testid="audit-row-untraced"]').first();
  if (await untraced.count()) await bringIntoView(app, '[data-testid="audit-row-untraced"]', 380);
  await shot(app, "04-audit-untraced");

  // 05 and 07: the policies, with their receipts and who confirmed them.
  await go(app, "/owner");
  await bringIntoView(app, '[data-testid^="policy-"]', 160);
  await app.page.locator('[data-testid^="policy-"] details').first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await app.page.waitForTimeout(300);
  await shot(app, "05-policy-receipts");
  await bringIntoView(app, '[data-testid^="policy-"]', 110);
  await app.page.locator('[data-testid^="policy-"] details').first().evaluate((d) => ((d as HTMLDetailsElement).open = false));
  await shot(app, "07-policies-who-confirmed");

  // 06: the architecture drawing, on receipt paper, 3:2.
  const svg = readFileSync(join(REPO_ROOT, "docs", "architecture.svg"), "utf8");
  await app.page.setContent(
    `<html><body style="margin:0;background:#f6efe3;display:flex;align-items:center;justify-content:center;height:1000px;width:1500px">
      <div style="width:1380px">${svg.replace("<svg ", '<svg style="width:100%;height:auto" ')}</div></body></html>`,
  );
  await app.page.waitForTimeout(400);
  await shot(app, "06-architecture");

  // 390 px: the support page on a phone.
  const phone = await app.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  await p.goto(`${BASE}/support`, { waitUntil: "networkidle" });
  await p.getByTestId("customer-asha").click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: join(REPO_ROOT, "submission", "support-390.png"), fullPage: true });
  console.log("  support-390.png");
  await phone.close();
} finally {
  await app.browser.close();
}

const r = spawnSync("ls", ["-la", OUT], { encoding: "utf8" });
console.log(r.stdout);
