/**
 * `pnpm video`: builds submission/video/final.mp4 from the captured scenes and their narration.
 *
 * 1. Each scene's frames become a 30 fps clip; long still stretches (the agent thinking) shrink to 1.2 s.
 * 2. Each clip is fitted to its narration: sped up (at most 2.2×) or held on its last frame.
 * 3. Remotion composes the title card, the clips with burned-in captions and callouts, and the end card.
 * 4. ffmpeg encodes H.264 (-preset veryfast) with AAC audio; captions.srt, youtube.txt and script.md are written.
 *   --skip-capture-check   build even if some scenes are missing
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, loadEnv } from "../lib/env";
import { seconds } from "./narrate";
import { PR_SCENE, SCENES, type Scene } from "./scenes";

loadEnv();
const FPS = 30;
const WORK = join(REPO_ROOT, "scripts", "video", "work");
const REMOTION = join(REPO_ROOT, "scripts", "video", "remotion");
const PUB = join(REMOTION, "public");
const OUT = join(REPO_ROOT, "submission", "video");
const REPO_URL = "github.com/bharatreachdsp/align-pay";
const MAX_GAP = 1.2;
const MAX_SPEED = 2.2;
const LEAD = 0.35;
const TAIL = 0.75;
const TITLE_S = 3.2;
const END_S = 5.5;
const LIMIT_S = 170;

mkdirSync(OUT, { recursive: true });
rmSync(PUB, { recursive: true, force: true });
mkdirSync(join(PUB, "scenes"), { recursive: true });
mkdirSync(join(PUB, "audio"), { recursive: true });

const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const prShot = process.env.ALIGN_PAY_PR_SCREENSHOT && existsSync(process.env.ALIGN_PAY_PR_SCREENSHOT) ? process.env.ALIGN_PAY_PR_SCREENSHOT : null;
const scenes: Scene[] = prShot ? [SCENES[0]!, SCENES[1]!, PR_SCENE, ...SCENES.slice(2)] : SCENES;
const narration = JSON.parse(readFileSync(join(WORK, "audio", "narration.json"), "utf8")) as Record<string, { seconds: number; engine: string }>;

interface Meta {
  duration: number;
  frames: { file: string; t: number }[];
  callouts: { t: number; x: number; y: number; w: number; h: number; label: string; hold: number }[];
}

/** Frames → a constant 30 fps clip, with still stretches shortened. Returns the clip and the time map. */
function clipFromFrames(id: string): { file: string; duration: number; map: (t: number) => number } {
  const dir = join(WORK, "scenes", id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  const frames = meta.frames.filter((f) => f.t >= 0);
  // Compressed time: every still stretch longer than MAX_GAP is cut down to MAX_GAP.
  const comp: number[] = [];
  let shift = 0;
  frames.forEach((f, i) => {
    if (i > 0) shift += Math.max(0, f.t - frames[i - 1]!.t - MAX_GAP);
    comp.push(f.t - shift);
  });
  const map = (t: number) => {
    let i = -1;
    for (let k = 0; k < frames.length && frames[k]!.t <= t; k++) i = k;
    return i < 0 ? t : comp[i]! + Math.min(t - frames[i]!.t, MAX_GAP);
  };
  const end = Math.max(0.5, map(Math.max(meta.duration, frames.at(-1)?.t ?? 0)));
  const out = frames.map((f, i) => ({ file: f.file, t: comp[i]! }));
  const list = out.map((f, i) => `file '${join(dir, f.file)}'\nduration ${Math.max(1 / FPS, ((out[i + 1]?.t ?? end) - f.t)).toFixed(4)}`).join("\n");
  writeFileSync(join(dir, "list.txt"), `${list}\nfile '${join(dir, out.at(-1)!.file)}'\n`);
  const file = join(dir, "clip.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-fps_mode", "cfr", "-r", String(FPS), "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf6efe3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", file]);
  return { file, duration: seconds(file), map };
}

/** A still image (the PR screenshot) as a clip. */
function clipFromImage(img: string, id: string, dur: number): string {
  const file = join(WORK, `${id}-still.mp4`);
  ff(["-loop", "1", "-i", img, "-t", dur.toFixed(2), "-r", String(FPS), "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf6efe3", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", file]);
  return file;
}

function chunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= 92) out.push(s);
    else {
      const words = s.split(" ");
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length > 80 && cur) {
          out.push(cur.trim());
          cur = w;
        } else cur += ` ${w}`;
      }
      if (cur.trim()) out.push(cur.trim());
    }
  }
  return out;
}

interface Cap {
  from: number;
  to: number;
  text: string;
}
const plan: { fps: number; width: number; height: number; repoUrl: string; scenes: unknown[] } = { fps: FPS, width: 1920, height: 1080, repoUrl: REPO_URL, scenes: [] };
const srt: { start: number; end: number; text: string }[] = [];
const scriptRows: string[] = [];
let cursor = 0;

plan.scenes.push({ id: "title", kind: "title", durationInFrames: Math.round(TITLE_S * FPS), captions: [], callouts: [] });
scriptRows.push(`| 0:00 | Title card: ALIGN Pay, "Every refund and invoice your AI agent makes in PayPal, traced to a human decision." | (none) |`);
cursor += TITLE_S;

for (const s of scenes) {
  const n = narration[s.id];
  if (!n) throw new Error(`No narration for ${s.id}: run pnpm video:narrate`);
  const want = n.seconds + LEAD + TAIL;
  let src: string;
  let footage: number;
  let map = (t: number) => t;
  let callouts: Meta["callouts"] = [];
  if (s.id === "pr") {
    src = clipFromImage(prShot!, "pr", want);
    footage = want;
  } else {
    if (!existsSync(join(WORK, "scenes", s.id, "meta.json"))) throw new Error(`Scene ${s.id} was not captured: run pnpm video:capture`);
    const c = clipFromFrames(s.id);
    src = c.file;
    footage = c.duration;
    map = c.map;
    callouts = (JSON.parse(readFileSync(join(WORK, "scenes", s.id, "meta.json"), "utf8")) as Meta).callouts;
  }
  const speed = footage > want ? Math.min(footage / want, MAX_SPEED) : 1;
  const dur = Math.max(want, footage / speed);
  const fitted = join(PUB, "scenes", `${s.id}.mp4`);
  ff(["-i", src, "-vf", `setpts=PTS/${speed.toFixed(4)},tpad=stop_mode=clone:stop_duration=${Math.ceil(dur) + 1}`, "-t", dur.toFixed(3), "-r", String(FPS), "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", fitted]);
  copyFileSync(join(WORK, "audio", `${s.id}.wav`), join(PUB, "audio", `${s.id}.wav`));
  const frames = Math.round(dur * FPS);
  // Captions follow the narration, sentence by sentence, in proportion to their length.
  const parts = chunks(s.narration);
  const total = parts.reduce((a, p) => a + p.length, 0);
  let t = LEAD;
  const caps: Cap[] = parts.map((p) => {
    const len = (p.length / total) * n.seconds;
    const c = { from: Math.round(t * FPS), to: Math.round((t + len) * FPS), text: p };
    srt.push({ start: cursor + t, end: cursor + t + len, text: p });
    t += len;
    return c;
  });
  const cs = callouts.map((c) => {
    const from = Math.round((map(c.t) / speed) * FPS);
    return { from, to: Math.min(frames - 6, from + Math.round(c.hold * FPS)), x: c.x, y: c.y, w: c.w, h: c.h, label: c.label };
  });
  plan.scenes.push({ id: s.id, kind: "segment", durationInFrames: frames, video: `scenes/${s.id}.mp4`, audio: `audio/${s.id}.wav`, audioDelayFrames: Math.round(LEAD * FPS), captions: caps, callouts: cs.filter((c) => c.to > c.from) });
  const mm = `${Math.floor(cursor / 60)}:${String(Math.floor(cursor % 60)).padStart(2, "0")}`;
  scriptRows.push(`| ${mm} | ${s.onScreen} | ${s.narration} |`);
  console.log(`  ${s.id}: footage ${footage.toFixed(1)} s → ${dur.toFixed(1)} s (×${speed.toFixed(2)}), narration ${n.seconds.toFixed(1)} s`);
  cursor += dur;
}

plan.scenes.push({ id: "end", kind: "end", durationInFrames: Math.round(END_S * FPS), captions: [], callouts: [] });
scriptRows.push(`| ${Math.floor(cursor / 60)}:${String(Math.floor(cursor % 60)).padStart(2, "0")} | End card: the principle, the repository link, MIT | (none) |`);
cursor += END_S;
console.log(`Total ${cursor.toFixed(1)} s`);
if (cursor > LIMIT_S) {
  console.error(`The video would be ${cursor.toFixed(1)} s, over the ${LIMIT_S} s limit.`);
  process.exit(1);
}

writeFileSync(join(REMOTION, "out-plan.json"), JSON.stringify({ plan }, null, 2));
mkdirSync(join(REMOTION, "out"), { recursive: true });
const render = join(REMOTION, "out", "render.mp4");
const r = spawnSync("npx", ["remotion", "render", "src/index.ts", "AlignPay", render, `--props=${join(REMOTION, "out-plan.json")}`, "--codec=h264", "--audio-codec=aac", "--log=warn"], { cwd: REMOTION, stdio: "inherit" });
if (r.status !== 0) {
  console.error("Remotion failed.");
  process.exit(1);
}
const final = join(OUT, "final.mp4");
ff(["-i", render, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", final]);

const ts = (x: number) => {
  const ms = Math.round(x * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
writeFileSync(join(OUT, "captions.srt"), srt.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n"));

const engines = [...new Set(Object.values(narration).map((x) => x.engine))];
writeFileSync(
  join(OUT, "script.md"),
  `# ALIGN Pay demo video: script\n\nFinal length: ${cursor.toFixed(1)} s. Narration: ${engines.join(", ")}. Captured from a real run of the local app against the PayPal sandbox, in ALIGN mode, with Playwright and the Chrome DevTools screencast; composed with Remotion.\n\n| Starts | On screen | Voiceover |\n| --- | --- | --- |\n${scriptRows.join("\n")}\n`,
);

const tags = ["PayPal", "PayPal sandbox", "PayPal Agent Toolkit", "AI agents", "Gemini", "agent payments", "refunds", "invoicing", "ALIGN", "decision ledger", "hackathon", "PayPal AI Hackathon", "TypeScript", "Next.js", "Model Context Protocol"];
writeFileSync(
  join(OUT, "youtube.txt"),
  `Title:\nALIGN Pay: every PayPal refund your AI agent makes, traced to a human decision\n\nDescription:\nALIGN Pay is an open-source guard between an AI agent and PayPal, built on ALIGN, the decision ledger for teams that build software with AI agents. Every refund and invoice the agent makes traces back to a human decision, with the exact quote as its receipt; anything without one is held or flagged.\n\nThe model proposes, a person confirms, plain code enforces. Gemini runs the support agent and drafts limits from each decision; the store owner confirms them; deterministic code enforces them against PayPal's own records (Orders, Payments, Invoicing, Disputes, Transaction Search, webhooks).\n\nKettle & Kesar is a fictional store. Everything runs in the PayPal sandbox: no real money moves.\n\nCode (MIT): https://${REPO_URL}\nBuilt for the PayPal AI Hackathon.\n\nTags:\n${tags.join(", ")}\n`,
);

const dur = seconds(final);
console.log(`final.mp4: ${dur.toFixed(1)} s`);
const frames = join(REPO_ROOT, ".data", "video-frames");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
for (const t of [1.5, 8, 25, 45, 65, 85, 105, 125, 145, dur - 2]) {
  if (t < dur) ff(["-ss", t.toFixed(1), "-i", final, "-frames:v", "1", "-q:v", "3", join(frames, `t${String(Math.round(t)).padStart(3, "0")}.jpg`)]);
}
console.log(`Frames for review: ${frames}`);
