import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** KEY=VALUE lines; surrounding single or double quotes are removed. Values are never printed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith("'") && v.endsWith("'") && v.length >= 2) || (v.startsWith('"') && v.endsWith('"') && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/** Loads <root>/.env then <root>/.env.local (later wins) into process.env, never overriding what is already set. */
export function loadEnvFiles(root: string, env: Record<string, string | undefined> = process.env): void {
  const merged: Record<string, string> = {};
  for (const f of [".env", ".env.local"]) {
    const p = join(root, f);
    if (existsSync(/*turbopackIgnore: true*/ p)) Object.assign(merged, parseEnvFile(readFileSync(/*turbopackIgnore: true*/ p, "utf8")));
  }
  for (const [k, v] of Object.entries(merged)) if (env[k] === undefined && v !== "") env[k] = v;
}
