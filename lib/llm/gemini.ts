import { ProviderError, type ProviderCall, type RawResult } from "./types";
import { httpError } from "./openrouter";
import { geminiCostUsd } from "./pricing";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function geminiCall(c: ProviderCall): Promise<RawResult> {
  const first = c.messages.findIndex((m) => m.role === "user");
  const contents = c.messages.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.text }, ...(i === first ? c.images.map((b) => ({ inlineData: { mimeType: "image/png", data: b.toString("base64") } })) : [])],
  }));
  let res: Response;
  try {
    res = await fetch(`${BASE}/models/${c.model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": c.apiKey, "content-type": "application/json" }, // header, never the URL, so keys can't leak into logs
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: c.system }] }, contents,
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: c.jsonSchema, temperature: 0.4, maxOutputTokens: c.maxOutTokens, ...(c.thinking ? { thinkingConfig: { thinkingBudget: c.thinking } } : {}) },
      }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (e: any) {
    throw new ProviderError(e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : "network", `Gemini: ${e.message}`);
  }
  if (!res.ok) throw httpError("Gemini", res.status, await res.text());
  let j: any;
  try { j = await res.json(); } catch (e: any) { throw new ProviderError(e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : "network", `Gemini: ${e.message}`); }
  const text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
  if (!text) throw new ProviderError("server", `Gemini: empty response (${j.candidates?.[0]?.finishReason ?? j.promptFeedback?.blockReason ?? "unknown"})`);
  const u = j.usageMetadata ?? {};
  const inTok = u.promptTokenCount ?? 0, cached = u.cachedContentTokenCount ?? 0;
  const outTok = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0); // thinking tokens are billed as output
  return { text, inTokens: inTok, outTokens: outTok, cachedTokens: cached, costUsd: geminiCostUsd(c.model, inTok, outTok, cached) };
}
