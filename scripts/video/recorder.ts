import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Locator, Page } from "playwright";

export interface CalloutMark {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  hold: number;
}

/**
 * Records one scene from one page through the Chrome DevTools Protocol (Page.startScreencast, JPEG quality 90).
 * Frames arrive only when the page changes; each is stored with its time, and the scene's video is built from them.
 */
export class Recorder {
  private cdp: CDPSession | null = null;
  private frames: { file: string; t: number }[] = [];
  private callouts: CalloutMark[] = [];
  private dir = "";
  private n = 0;
  private start = 0;

  /** `scale` turns CSS pixels into frame pixels (the page's deviceScaleFactor). */
  constructor(
    private readonly root: string,
    private readonly scale = 1,
  ) {}

  async begin(page: Page, sceneId: string): Promise<void> {
    this.dir = join(this.root, sceneId);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.callouts = [];
    this.n = 0;
    this.start = Date.now() / 1000;
    this.cdp = await page.context().newCDPSession(page);
    this.cdp.on("Page.screencastFrame", (e: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const file = `f${String(++this.n).padStart(5, "0")}.jpg`;
      writeFileSync(join(this.dir, file), Buffer.from(e.data, "base64"));
      this.frames.push({ file, t: (e.metadata.timestamp ?? Date.now() / 1000) - this.start });
      void this.cdp?.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    });
    await this.snap();
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  }

  /** A full frame now (the screencast sends nothing while the page is still). */
  async snap(): Promise<void> {
    if (!this.cdp) return;
    const r = (await this.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 })) as { data: string };
    const file = `f${String(++this.n).padStart(5, "0")}.jpg`;
    writeFileSync(join(this.dir, file), Buffer.from(r.data, "base64"));
    this.frames.push({ file, t: Date.now() / 1000 - this.start });
  }

  /** Marks an element for a callout box in the video, from now, for `hold` seconds. */
  async callout(loc: Locator, label: string, hold = 3.5): Promise<void> {
    // Measure only once the element is in view and the page has settled.
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.page().waitForTimeout(450);
    const b = await loc.boundingBox().catch(() => null);
    if (b) {
      const k = this.scale;
      this.callouts.push({ t: Date.now() / 1000 - this.start, x: b.x * k, y: b.y * k, w: b.width * k, h: b.height * k, label, hold });
    }
  }

  async end(): Promise<{ dir: string; duration: number }> {
    await this.snap();
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    await this.cdp?.detach().catch(() => {});
    this.cdp = null;
    const duration = Date.now() / 1000 - this.start;
    this.frames.sort((a, b) => a.t - b.t);
    writeFileSync(join(this.dir, "meta.json"), JSON.stringify({ duration, frames: this.frames, callouts: this.callouts }, null, 2));
    return { dir: this.dir, duration };
  }
}
