// USD per 1M tokens. Used for Gemini-direct calls (OpenRouter returns its own actual cost).
// Editable in Settings; user edits override these defaults.
import { getJson, setJson } from "../db/settings";

export type Price = { in: number; out: number; cached_in: number; source: string; checked: string };

export const DEFAULT_PRICING: Record<string, Price> = {
  "gemini-2.5-pro": { in: 1.25, out: 10, cached_in: 0.125, source: "https://ai.google.dev/gemini-api/docs/pricing (≤200k prompt tier; matches OpenRouter list)", checked: "2026-11-25" },
  "gemini-2.5-flash": { in: 0.3, out: 2.5, cached_in: 0.03, source: "https://ai.google.dev/gemini-api/docs/pricing (matches OpenRouter list)", checked: "2026-11-25" },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4, cached_in: 0.01, source: "https://ai.google.dev/gemini-api/docs/pricing (matches OpenRouter list)", checked: "2026-11-25" },
};
export const DEFAULT_FX = { usd_inr: 92.93, source: "https://open.er-api.com/v6/latest/USD", checked: "2026-11-25" };

export const getPricing = () => ({ ...DEFAULT_PRICING, ...getJson<Record<string, Price>>("pricing", {}) });
export const setPricing = (p: Record<string, Price>) => setJson("pricing", p);
export const getFx = () => getJson("fx", DEFAULT_FX);
export const setFx = (v: typeof DEFAULT_FX) => setJson("fx", v);

export function geminiCostUsd(model: string, inTok: number, outTok: number, cachedTok: number): number {
  const p = getPricing()[model];
  if (!p) return 0;
  return ((inTok - cachedTok) * p.in + cachedTok * p.cached_in + outTok * p.out) / 1e6;
}
export const toInr = (usd: number) => usd * getFx().usd_inr;
