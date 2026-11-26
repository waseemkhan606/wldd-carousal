import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSetting } from "@/lib/db/settings";
import { modelsFor } from "@/lib/llm/router";
import { openrouterCall } from "@/lib/llm/openrouter";
import { geminiCall } from "@/lib/llm/gemini";

export const dynamic = "force-dynamic";

/** Tiny 1-token-ish call to check a key works. Costs a fraction of a paisa. */
export async function POST(req: NextRequest) {
  const { provider } = (await req.json()) as { provider: string };
  if (provider !== "openrouter" && provider !== "gemini") return NextResponse.json({ ok: false, error: "unknown provider" }, { status: 400 });
  const apiKey = getSetting(`key.${provider}`);
  if (!apiKey) return NextResponse.json({ ok: false, error: "No key saved" });
  const model = modelsFor("vision_cheap")[provider as "openrouter" | "gemini"];
  try {
    const call = provider === "openrouter" ? openrouterCall : geminiCall;
    await call({ model, system: "Reply with JSON.", messages: [{ role: "user", text: 'Return {"ok":true}' }], images: [], jsonSchema: z.toJSONSchema(z.object({ ok: z.boolean() })), timeoutMs: 20000, maxOutTokens: 50, apiKey });
    return NextResponse.json({ ok: true, model });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message).split(apiKey).join("***") });
  }
}
