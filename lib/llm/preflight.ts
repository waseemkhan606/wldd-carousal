// Fail BEFORE spending: check that some provider can actually pay for the job, so a run never dies half-way
// with credits already burnt on work that then has to be repeated.
import { getSetting } from "../db/settings";

export class CreditError extends Error { constructor(m: string) { super(m); this.name = "CreditError"; } }

/** Remaining OpenRouter credit in USD (null = unlimited or unknown). Throws only on a rejected key. */
export async function openrouterRemaining(): Promise<number | null> {
  const key = getSetting("key.openrouter"); if (!key) return null;
  const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r) return null; // network blip: let the real call decide
  if (r.status === 401 || r.status === 403) throw new CreditError("OpenRouter rejected the saved key. Open Settings and paste a valid key (or one with credit).");
  const j: any = await r.json().catch(() => null);
  const rem = j?.data?.limit_remaining;
  return typeof rem === "number" ? rem : null;
}

export async function assertCredits(estUsd: number, what: string): Promise<void> {
  const hasGemini = !!getSetting("key.gemini");
  let rem: number | null = null;
  try { rem = await openrouterRemaining(); } catch (e) { if (!hasGemini) throw e; return; }
  if (!getSetting("key.openrouter") && !hasGemini) throw new CreditError("No API key is set. Open Settings and add an OpenRouter or Gemini key.");
  if (rem !== null && rem < estUsd && !hasGemini)
    throw new CreditError(`Not enough OpenRouter credit for ${what}: $${Math.max(0, rem).toFixed(2)} left, about $${estUsd.toFixed(2)} needed. Nothing was spent. Top up the key (or add a Gemini key as a fallback) and run it again.`);
}
