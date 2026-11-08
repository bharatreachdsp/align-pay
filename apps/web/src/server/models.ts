import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { Logger } from "@align-agent/paypal-guard";

/**
 * A free Gemini key allows few requests per model per day, and busy models answer "high demand". A comma-separated
 * list of model ids (GEMINI_MODEL, GEMINI_FAST_MODEL) is tried in order: on a quota, overload or unavailable answer the
 * next model is used, and the exhausted one is skipped for ten minutes. Nothing about money depends on which model
 * answers: models only talk, draft limits a person confirms, and write explanations.
 */
const RETRY_NEXT = /quota|RESOURCE_EXHAUSTED|high demand|overloaded|UNAVAILABLE|no longer available|not found|Thinking level/i;

function shouldTryNext(e: unknown): boolean {
  const status = (e as { statusCode?: number }).statusCode ?? 0;
  return [404, 429, 500, 503, 504].includes(status) || RETRY_NEXT.test(String((e as Error)?.message ?? ""));
}

export function fallbackModel(ids: string[], make: (id: string) => LanguageModelV3, log: Logger): LanguageModelV3 {
  const models = ids.map((id) => ({ id, model: make(id), skipUntil: 0 }));
  async function attempt<T>(fn: (m: LanguageModelV3) => PromiseLike<T>): Promise<T> {
    let last: unknown = null;
    const now = Date.now();
    const order = [...models.filter((m) => m.skipUntil <= now), ...models.filter((m) => m.skipUntil > now)];
    for (const m of order) {
      try {
        return await fn(m.model);
      } catch (e) {
        last = e;
        if (!shouldTryNext(e)) throw e;
        m.skipUntil = Date.now() + 10 * 60_000;
        log.warn("model unavailable, trying the next", { model: m.id, error: String((e as Error)?.message ?? "").slice(0, 120) });
      }
    }
    throw last;
  }
  return {
    specificationVersion: "v3",
    provider: "google",
    modelId: ids[0]!,
    supportedUrls: models[0]!.model.supportedUrls,
    doGenerate: (o: LanguageModelV3CallOptions) => attempt((m) => m.doGenerate(o)),
    doStream: (o: LanguageModelV3CallOptions) => attempt((m) => m.doStream(o)),
  };
}

export const modelList = (v: string | undefined, fallback: string): string[] =>
  (v ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
