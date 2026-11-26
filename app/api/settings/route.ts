import { NextResponse, type NextRequest } from "next/server";
import { getSetting, setSetting, mask, getJson, setJson } from "@/lib/db/settings";
import { DEFAULT_MODELS } from "@/lib/llm/models";
import { getPricing, setPricing, getFx, setFx } from "@/lib/llm/pricing";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    keys: { openrouter: mask(getSetting("key.openrouter")), gemini: mask(getSetting("key.gemini")) }, // keys are never returned in full
    models: { ...DEFAULT_MODELS, ...getJson("models", {}) },
    pricing: getPricing(), fx: getFx(),
  });
}

export async function PUT(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if ("openrouter_key" in b) setSetting("key.openrouter", String(b.openrouter_key).trim() || null);
  if ("gemini_key" in b) setSetting("key.gemini", String(b.gemini_key).trim() || null);
  if (b.models) setJson("models", b.models);
  if (b.pricing) setPricing(b.pricing);
  if (b.fx) setFx(b.fx);
  return NextResponse.json({ ok: true });
}
