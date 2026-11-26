import type { z } from "zod";
import type { Tier } from "./models";

export type LlmRequest<T extends z.ZodTypeAny> = {
  stage: string;            // e.g. "ingest.spec", "carousel.copy"
  tier: Tier;
  system: string;           // static content FIRST (prompt-cache friendly)
  user: string;             // variable content last
  images?: Buffer[];        // PNG, already downscaled by the caller
  schema: T;
  carouselId?: number | null;
  lookbookId?: number | null;
  timeoutMs?: number;       // default 45s per brief; ingest passes more
  maxOutTokens?: number;
  thinking?: number;        // cap on reasoning tokens (cost control); omitted = provider default
};

export type Usage = {
  provider: "openrouter" | "gemini"; model: string; inTokens: number; outTokens: number; cachedTokens: number;
  images: number; costUsd: number; latencyMs: number; fallbackUsed: boolean; stage: string;
};

export type RawResult = { text: string; inTokens: number; outTokens: number; cachedTokens: number; costUsd: number | null };

export class ProviderError extends Error {
  constructor(public kind: "rate_limit" | "server" | "timeout" | "no_key" | "auth" | "bad_request" | "network", msg: string, public status?: number) {
    super(msg);
  }
  /** Failures worth trying the other provider for. */
  get fallbackable() { return true; }
}

export type ChatMsg = { role: "user" | "assistant"; text: string };
export type ProviderCall = {
  model: string; system: string; messages: ChatMsg[]; images: Buffer[]; jsonSchema: unknown; timeoutMs: number; maxOutTokens?: number; thinking?: number; apiKey: string;
};
