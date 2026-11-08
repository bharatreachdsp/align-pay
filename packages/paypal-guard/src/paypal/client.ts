import type { z } from "zod";

/** The only PayPal host ALIGN Pay ever talks to. */
export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (m, d) => console.log(`[align-pay] ${m}`, d ? JSON.stringify(d) : ""),
  warn: (m, d) => console.warn(`[align-pay] ${m}`, d ? JSON.stringify(d) : ""),
  error: (m, d) => console.error(`[align-pay] ${m}`, d ? JSON.stringify(d) : ""),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A PayPal error, carrying only what is safe to log: status, PayPal's error name, debug id and issue codes. */
export class PayPalError extends Error {
  override readonly name = "PayPalError";
  constructor(
    readonly status: number,
    readonly paypalName: string | null,
    readonly debugId: string | null,
    readonly issues: string[],
    readonly path: string,
  ) {
    super(
      `PayPal answered ${status}${paypalName ? ` ${paypalName}` : ""}${issues.length ? ` (${issues.join(", ")})` : ""} on ${path}${
        debugId ? ` · debug_id ${debugId}` : ""
      }`,
    );
  }
  get notAuthorized(): boolean {
    return this.status === 403 || this.paypalName === "NOT_AUTHORIZED" || this.paypalName === "PERMISSION_DENIED";
  }
}

export interface RequestOptions<T> {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Idempotency key. Every mutation sends one. */
  requestId?: string;
  prefer?: "return=representation" | "return=minimal";
  schema?: z.ZodType<T>;
  /** Treat these statuses as an empty success (e.g. 204). */
  allowEmpty?: boolean;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: FetchLike;
  log?: Logger;
  /** Base delay for retries; tests set it to 0. */
  retryDelayMs?: number;
}

/**
 * OAuth2 client credentials against the sandbox, typed calls, retries only on 429 and 5xx (never on other 4xx).
 * Bodies are never logged: they can hold personal data.
 */
export class PayPalClient {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly log: Logger;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;
  private readonly retryDelayMs: number;

  constructor(private readonly opts: PayPalClientOptions) {
    this.baseUrl = (opts.baseUrl ?? SANDBOX_BASE_URL).replace(/\/$/, "");
    if (this.baseUrl !== SANDBOX_BASE_URL) {
      throw new Error("ALIGN Pay only talks to the PayPal sandbox (https://api-m.sandbox.paypal.com).");
    }
    if (!opts.clientId || !opts.clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.");
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.log = opts.log ?? consoleLogger;
    this.retryDelayMs = opts.retryDelayMs ?? 400;
  }

  /** The cached token, refreshed 60 s before it expires. `force` fetches a new one (permissions can arrive late). */
  async accessToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    if (!force && this.tokenPromise) return this.tokenPromise;
    const p = (async () => {
      const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
      const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });
      if (!res.ok) {
        const debugId = res.headers.get("paypal-debug-id");
        this.log.error("PayPal token request failed", { status: res.status, debug_id: debugId });
        throw new PayPalError(res.status, "AUTHENTICATION_FAILURE", debugId, [], "/v1/oauth2/token");
      }
      const json = (await res.json()) as { access_token: string; expires_in: number };
      this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
      return json.access_token;
    })();
    this.tokenPromise = p;
    try {
      return await p;
    } finally {
      this.tokenPromise = null;
    }
  }

  async request<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, o: RequestOptions<T> = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    if (method !== "GET" && method !== "DELETE" && !o.requestId && path !== "/v1/notifications/verify-webhook-signature") {
      throw new Error(`Every PayPal mutation needs a PayPal-Request-Id (${method} ${path}).`);
    }
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(false);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      if (o.body !== undefined) headers["Content-Type"] = "application/json";
      if (o.requestId) headers["PayPal-Request-Id"] = o.requestId;
      if (o.prefer) headers.Prefer = o.prefer;
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body),
        });
      } catch (e) {
        if (attempt < 2) {
          await this.sleep(attempt);
          continue;
        }
        this.log.error("PayPal unreachable", { path, error: (e as Error).name });
        throw e;
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        this.log.warn("PayPal busy, retrying", { path, status: res.status, debug_id: res.headers.get("paypal-debug-id") });
        await this.sleep(attempt);
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let name: string | null = null;
        let debugId: string | null = res.headers.get("paypal-debug-id");
        let issues: string[] = [];
        try {
          const j = JSON.parse(text) as { name?: string; debug_id?: string; details?: { issue?: string }[] };
          name = j.name ?? null;
          debugId = j.debug_id ?? debugId;
          issues = (j.details ?? []).map((d) => d.issue ?? "").filter(Boolean);
        } catch {
          // not JSON; nothing more to say
        }
        const err = new PayPalError(res.status, name, debugId, issues, path);
        // A permission granted after the token was issued needs a fresh token (Transaction Search can arrive late).
        if (err.notAuthorized && !refreshed) {
          refreshed = true;
          await this.accessToken(true);
          continue;
        }
        this.log.warn("PayPal error", { method, path, status: res.status, name, debug_id: debugId, issues });
        throw err;
      }
      if (!text) {
        if (o.allowEmpty || res.status === 204 || res.status === 202) return undefined as T;
        return undefined as T;
      }
      const json: unknown = JSON.parse(text);
      return o.schema ? o.schema.parse(json) : (json as T);
    }
  }

  private sleep(attempt: number): Promise<void> {
    const ms = this.retryDelayMs * 2 ** attempt;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }
}

/** Refuses to start unless PAYPAL_ENV=sandbox. */
export function assertSandboxEnv(env: Record<string, string | undefined> = process.env): void {
  if (env.PAYPAL_ENV !== "sandbox") {
    throw new Error("ALIGN Pay runs only against the PayPal sandbox. Set PAYPAL_ENV=sandbox.");
  }
}

export function clientFromEnv(env: Record<string, string | undefined> = process.env, log?: Logger): PayPalClient {
  assertSandboxEnv(env);
  return new PayPalClient({
    clientId: env.PAYPAL_CLIENT_ID ?? "",
    clientSecret: env.PAYPAL_CLIENT_SECRET ?? "",
    ...(log ? { log } : {}),
  });
}
