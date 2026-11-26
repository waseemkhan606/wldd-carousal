import { z } from "zod";
import { getSetting, getJson } from "../db/settings";
import { DEFAULT_MODELS, type Tier, type ModelPair } from "./models";
import { openrouterCall } from "./openrouter";
import { geminiCall } from "./gemini";
import { logCall } from "./usage";
import { ProviderError, type LlmRequest, type Usage, type ChatMsg, type RawResult } from "./types";

export class LlmError extends Error {
  constructor(msg: string, public causes: string[]) { super(msg); }
}

export function modelsFor(tier: Tier): ModelPair {
  return { ...DEFAULT_MODELS[tier], ...getJson<Partial<Record<Tier, Partial<ModelPair>>>>("models", {})[tier] };
}

type Provider = "openrouter" | "gemini";
const CALLS = { openrouter: openrouterCall, gemini: geminiCall };
const KEYS = { openrouter: "key.openrouter", gemini: "key.gemini" } as const;

function parse<T extends z.ZodTypeAny>(schema: T, text: string): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  let json: unknown;
  try { json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (e: any) { return { ok: false, error: `Invalid JSON: ${e.message}` }; }
  const r = schema.safeParse(json);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: z.prettifyError(r.error).slice(0, 1500) };
}

/**
 * Cost-first routing: OpenRouter, then Gemini direct.
 * Budget per call: 1 repair (same provider, includes the zod error) + 1 provider fallback. Nothing else is retried.
 */
export async function llmCall<T extends z.ZodTypeAny>(req: LlmRequest<T>): Promise<{ data: z.infer<T>; usage: Usage }> {
  const jsonSchema = z.toJSONSchema(req.schema);
  const models = modelsFor(req.tier);
  const causes: string[] = [];
  let repaired = false;

  for (const [n, provider] of (["openrouter", "gemini"] as Provider[]).entries()) {
    const apiKey = getSetting(KEYS[provider]);
    if (!apiKey) { causes.push(`${provider}: no API key set`); continue; }
    const model = models[provider];
    const messages: ChatMsg[] = [{ role: "user", text: req.user }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const t0 = Date.now();
      let raw: RawResult;
      try {
        raw = await withDeadline(CALLS[provider]({ model, system: req.system, messages, images: req.images ?? [], jsonSchema, timeoutMs: req.timeoutMs ?? 45000, maxOutTokens: req.maxOutTokens, thinking: req.thinking, apiKey }), (req.timeoutMs ?? 45000) + 10000);
      } catch (e: any) {
        logCall(mkUsage(provider, model, req, null, Date.now() - t0, n > 0), false, req);
        causes.push(e instanceof ProviderError ? `${provider}: ${e.kind}: ${redact(e.message, apiKey)}` : `${provider}: ${redact(String(e), apiKey)}`);
        break; // provider failed -> fall back
      }
      const usage = mkUsage(provider, model, req, raw, Date.now() - t0, n > 0);
      const p = parse(req.schema, raw.text);
      if (p.ok) { logCall(usage, true, req); return { data: p.data, usage }; }
      logCall(usage, false, req); // the tokens were spent even though the output was unusable
      if (repaired) { causes.push(`${provider}: schema-invalid after repair`); break; }
      repaired = true;
      messages.push({ role: "assistant", text: raw.text }, { role: "user", text: `Your JSON failed validation. Fix ONLY these problems and return the complete corrected JSON:\n${p.error}` });
    }
  }
  throw new LlmError(`LLM call "${req.stage}" failed on every provider. ${causes.join(" | ")}`, causes);
}

function mkUsage(provider: Provider, model: string, req: { stage: string; images?: Buffer[] }, raw: RawResult | null, latencyMs: number, fallbackUsed: boolean): Usage {
  return { provider, model, inTokens: raw?.inTokens ?? 0, outTokens: raw?.outTokens ?? 0, cachedTokens: raw?.cachedTokens ?? 0, images: req.images?.length ?? 0, costUsd: raw?.costUsd ?? 0, latencyMs, fallbackUsed, stage: req.stage };
}
function redact(s: string, _key?: string): string {
  // scrub every stored key, whichever provider's error this came from
  return (["key.openrouter", "key.gemini"] as const).reduce((acc, k) => { const v = getSetting(k); return v ? acc.split(v).join("***") : acc; }, s);
}


/** Hard ceiling on a provider call, independent of fetch's own timeout (a stalled socket must never hold a job for minutes). */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const dl = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ProviderError("timeout", `no answer within ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([p, dl]).finally(() => clearTimeout(t));
}
