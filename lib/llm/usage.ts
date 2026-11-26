import { db } from "../db";
import { toInr } from "./pricing";
import type { Usage } from "./types";

export function logCall(u: Usage, ok: boolean, ids: { carouselId?: number | null; lookbookId?: number | null }) {
  // Never log prompts, keys or look book text: numbers and ids only.
  db().prepare(`INSERT INTO llm_calls(carousel_id,lookbook_id,stage,provider,model,in_tokens,out_tokens,cached_tokens,images,cost_usd,latency_ms,fallback_used,ok)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ids.carouselId ?? null, ids.lookbookId ?? null, u.stage, u.provider, u.model, u.inTokens, u.outTokens, u.cachedTokens, u.images, u.costUsd, u.latencyMs, u.fallbackUsed ? 1 : 0, ok ? 1 : 0);
}

export type CostRow = { stage: string; model: string; provider: string; calls: number; in_tokens: number; out_tokens: number; images: number; usd: number; inr: number; fallback: boolean };

function summarise(rows: any[]): { rows: CostRow[]; usd: number; inr: number } {
  const out = rows.map((r) => ({ ...r, inr: toInr(r.usd), fallback: !!r.fallback }));
  const usd = out.reduce((s, r) => s + r.usd, 0);
  return { rows: out, usd, inr: toInr(usd) };
}
const SELECT = `SELECT stage, model, provider, COUNT(*) calls, SUM(in_tokens) in_tokens, SUM(out_tokens) out_tokens, SUM(images) images, SUM(cost_usd) usd, MAX(fallback_used) fallback FROM llm_calls`;
export const carouselCost = (id: number) => summarise(db().prepare(`${SELECT} WHERE carousel_id=? GROUP BY stage, model, provider`).all(id));
export const lookbookCost = (id: number) => summarise(db().prepare(`${SELECT} WHERE lookbook_id=? GROUP BY stage, model, provider`).all(id));
