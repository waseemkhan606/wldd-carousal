import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "router-"));
const { setSetting } = await import("@/lib/db/settings");
const { llmCall, LlmError } = await import("@/lib/llm/router");
const { db } = await import("@/lib/db");

const Schema = z.object({ a: z.number() });
const orOk = (content: string, cost = 0.002) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 10, cost } }));
const gemOk = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50 } }));
const req = { stage: "t", tier: "text_cheap" as const, system: "s", user: "u", schema: Schema };

beforeEach(() => {
  db().exec("DELETE FROM llm_calls");
  setSetting("key.openrouter", "or-secret-key"); setSetting("key.gemini", "gem-secret-key");
  vi.restoreAllMocks();
});
const urls = (f: any) => f.mock.calls.map((c: any[]) => String(c[0]));

describe("llm router", () => {
  it("happy path uses OpenRouter's reported cost", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(orOk('{"a":1}', 0.0031));
    const r = await llmCall(req);
    expect(r.data).toEqual({ a: 1 }); expect(r.usage.provider).toBe("openrouter"); expect(r.usage.costUsd).toBe(0.0031); expect(f).toHaveBeenCalledTimes(1);
  });
  it("one repair on schema failure, then success, same provider", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(orOk('{"a":"x"}')).mockResolvedValueOnce(orOk('{"a":2}'));
    const r = await llmCall(req);
    expect(r.data.a).toBe(2); expect(f).toHaveBeenCalledTimes(2);
    expect(JSON.parse((f.mock.calls[1][1] as any).body).messages.at(-1).content).toContain("failed validation");
    const rows = db().prepare("SELECT ok FROM llm_calls ORDER BY id").all() as any[];
    expect(rows.map((x) => x.ok)).toEqual([0, 1]); // the failed attempt's tokens are still accounted
  });
  it("429 falls back to Gemini, flags fallback_used, prices thinking tokens as output", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("slow down", { status: 429 })).mockResolvedValueOnce(gemOk('{"a":3}'));
    const r = await llmCall(req);
    expect(r.usage.provider).toBe("gemini"); expect(r.usage.fallbackUsed).toBe(true); expect(r.usage.outTokens).toBe(150);
    expect(r.usage.costUsd).toBeCloseTo((1000 * 0.3 + 150 * 2.5) / 1e6, 8);
    expect(urls(f)[1]).not.toContain("gem-secret-key"); // key travels in a header, not the URL
  });
  it("schema-invalid after repair falls back; repair budget is not reused on fallback", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(orOk("{}")).mockResolvedValueOnce(orOk("{}")).mockResolvedValueOnce(gemOk("{}"));
    await expect(llmCall(req)).rejects.toBeInstanceOf(LlmError);
    expect(f).toHaveBeenCalledTimes(3); // or, or(repair), gemini — and no more
  });
  it("missing OpenRouter key goes straight to Gemini", async () => {
    setSetting("key.openrouter", null);
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(gemOk('{"a":4}'));
    const r = await llmCall(req);
    expect(r.usage.provider).toBe("gemini"); expect(f).toHaveBeenCalledTimes(1);
  });
  it("both down: clear error with no key material in it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("boom gem-secret-key or-secret-key", { status: 503 }));
    const e: any = await llmCall(req).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError); expect(e.message).toContain("openrouter"); expect(e.message).toContain("gemini");
    expect(e.message).not.toContain("gem-secret-key"); expect(e.message).not.toContain("or-secret-key");
  });
});
