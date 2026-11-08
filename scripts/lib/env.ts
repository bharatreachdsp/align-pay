import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.ALIGN_PAY_DATA_DIR ?? join(REPO_ROOT, ".data");
export const DB_FILE = join(DATA_DIR, "align-pay.db");

/** KEY=VALUE lines; surrounding single or double quotes are removed. Values are never printed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2]!.trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/** Loads the repository's .env and .env.local (later wins) into process.env, without overriding what is set. */
export function loadEnv(): void {
  const merged: Record<string, string> = {};
  for (const f of [".env", ".env.local"]) {
    const p = join(REPO_ROOT, f);
    if (existsSync(p)) Object.assign(merged, parseEnvFile(readFileSync(p, "utf8")));
  }
  for (const [k, v] of Object.entries(merged)) if (process.env[k] === undefined && v !== "") process.env[k] = v;
}

export function requireEnv(names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}
