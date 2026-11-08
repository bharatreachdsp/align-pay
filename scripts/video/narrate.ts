/**
 * `pnpm video:narrate`: one narration clip per scene. Gemini text-to-speech through the Gemini API (the same key),
 * falling back to macOS `say` with the best installed English voice. Output: scripts/video/work/audio/<id>.wav.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, loadEnv } from "../lib/env";
import { SCENES, type Scene } from "./scenes";

loadEnv();
const OUT = join(REPO_ROOT, "scripts", "video", "work", "audio");
mkdirSync(OUT, { recursive: true });
const VOICE = process.env.GEMINI_TTS_VOICE ?? "Charon";
const MODELS = [process.env.GEMINI_TTS_MODEL, "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"].filter(Boolean) as string[];

export function seconds(file: string): number {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
}

async function gemini(text: string, file: string): Promise<string | null> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) return null;
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read this as the calm, clear, warm narrator of a short product demo, at an unhurried pace: ${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      }),
    });
    if (!res.ok) {
      console.warn(`  ${model}: HTTP ${res.status}`);
      continue;
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) continue;
    const pcm = `${file}.pcm`;
    writeFileSync(pcm, Buffer.from(part.data, "base64"));
    const rate = /rate=(\d+)/.exec(part.mimeType ?? "")?.[1] ?? "24000";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "s16le", "-ar", rate, "-ac", "1", "-i", pcm, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse", "-ar", "48000", file]);
    spawnSync("rm", ["-f", pcm]);
    return `gemini:${model}:${VOICE}`;
  }
  return null;
}

let sayVoice: string | null = null;
/** The best installed English voice, chosen once: a Premium or Enhanced voice if there is one, else Samantha. */
function bestSayVoice(): string {
  if (sayVoice) return sayVoice;
  const names = spawnSync("say", ["-v", "?"], { encoding: "utf8" })
    .stdout.split("\n")
    .filter((l) => /\sen_(US|GB)\s/.test(l))
    .map((l) => l.replace(/\s+en_(US|GB).*$/, "").trim());
  sayVoice =
    names.find((n) => /\((Premium)\)/.test(n)) ?? names.find((n) => /\((Enhanced)\)/.test(n)) ?? ["Samantha", "Daniel", "Karen"].find((n) => names.includes(n)) ?? "Samantha";
  return sayVoice;
}

function macSay(text: string, file: string): string {
  const voice = bestSayVoice();
  const aiff = `${file}.aiff`;
  execFileSync("say", ["-v", voice, "-r", "175", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "48000", "-ac", "1", file]);
  spawnSync("rm", ["-f", aiff]);
  return `say:${voice}`;
}

export async function narrate(scenes: Scene[]): Promise<Record<string, { seconds: number; engine: string }>> {
  const out: Record<string, { seconds: number; engine: string }> = {};
  for (const s of scenes) {
    const file = join(OUT, `${s.id}.wav`);
    const engine = (process.argv.includes("--say") ? null : await gemini(s.narration, file)) ?? macSay(s.narration, file);
    out[s.id] = { seconds: seconds(file), engine };
    console.log(`  ${s.id}: ${out[s.id]!.seconds.toFixed(1)} s (${engine})`);
  }
  writeFileSync(join(OUT, "narration.json"), JSON.stringify(out, null, 2));
  return out;
}

if (process.argv[1]?.endsWith("narrate.ts")) {
  await narrate(SCENES);
}
