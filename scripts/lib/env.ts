import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "@align-agent/paypal-guard/env";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.ALIGN_PAY_DATA_DIR ?? join(REPO_ROOT, ".data");
export const DB_FILE = join(DATA_DIR, "align-pay.db");

export function loadEnv(): void {
  loadEnvFiles(REPO_ROOT);
}

export function requireEnv(names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}
