import { ProviderError, type ProviderCall, type RawResult } from "./types";

export const OR_BASE = "https://openrouter.ai/api/v1";

export async function openrouterCall(c: ProviderCall): Promise<RawResult> {
  const first = firstUser(c.messages);
  const msgs: any[] = [{ role: "system", content: c.system }];
  c.messages.forEach((m, i) => {
    if (i === first && c.images.length) {
      msgs.push({ role: "user", content: [{ type: "text", text: m.text }, ...c.images.map((b) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b.toString("base64")}` } }))] });
    } else msgs.push({ role: m.role, content: m.text });
  });
  let res: Response;
  try {
    res = await fetch(`${OR_BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.apiKey}`, "content-type": "application/json", "x-title": "Carousel Studio" },
      body: JSON.stringify({
        model: c.model, messages: msgs, usage: { include: true }, temperature: 0.4,
        max_tokens: c.maxOutTokens,
        ...(c.thinking ? { reasoning: { max_tokens: c.thinking } } : {}),
        response_format: { type: "json_schema", json_schema: { name: "result", strict: false, schema: /^anthropic\//.test(c.model) ? anthropicSafe(c.jsonSchema) : c.jsonSchema } },
      }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
  } catch (e: any) {
    throw new ProviderError(e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : "network", `OpenRouter: ${e.message}`);
  }
  if (!res.ok) throw httpError("OpenRouter", res.status, await res.text());
  let j: any;
  try { j = await res.json(); } catch (e: any) { throw new ProviderError(e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : "network", `OpenRouter: ${e.message}`); }
  if (j.error) throw new ProviderError(j.error.code === 429 ? "rate_limit" : "server", `OpenRouter: ${String(j.error.message).slice(0, 200)}`, j.error.code);
  const text = j.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new ProviderError("server", "OpenRouter: empty response");
  const u = j.usage ?? {};
  return {
    text, inTokens: u.prompt_tokens ?? 0, outTokens: u.completion_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    costUsd: typeof u.cost === "number" ? u.cost : null, // actual billed cost
  };
}

const firstUser = (m: { role: string }[]) => m.findIndex((x) => x.role === "user");

export function httpError(who: string, status: number, body: string): ProviderError {
  const snippet = body.replace(/\s+/g, " ").slice(0, 200);
  if (status === 429) return new ProviderError("rate_limit", `${who} 429: ${snippet}`, status);
  if (status >= 500) return new ProviderError("server", `${who} ${status}: ${snippet}`, status);
  if (status === 401 || status === 403) return new ProviderError("auth", `${who} rejected the key (${status})`, status);
  return new ProviderError("bad_request", `${who} ${status}: ${snippet}`, status);
}

export async function listOpenrouterModels(): Promise<{ id: string; in: number; out: number; modalities: string[] }[]> {
  const r = await fetch(`${OR_BASE}/models`, { signal: AbortSignal.timeout(20000) });
  const j: any = await r.json();
  return j.data.map((m: any) => ({ id: m.id, in: Number(m.pricing.prompt) * 1e6, out: Number(m.pricing.completion) * 1e6, modalities: m.architecture?.input_modalities ?? [] }));
}


/** Anthropic's structured output accepts a strict subset of JSON Schema: closed objects, no numeric/length/format keywords. */
function anthropicSafe(node: any): any {
  if (Array.isArray(node)) return node.map(anthropicSafe);
  if (!node || typeof node !== "object") return node;
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "default", "$schema", "multipleOf", "minItems", "maxItems", "uniqueItems", "propertyNames", "patternProperties"].includes(k)) continue;
    out[k] = anthropicSafe(v);
  }
  if ((out.type === "object" || out.properties) && !(out.additionalProperties && typeof out.additionalProperties === "object")) { out.additionalProperties = false; if (out.properties && !out.required) out.required = Object.keys(out.properties); }
  return out;
}
