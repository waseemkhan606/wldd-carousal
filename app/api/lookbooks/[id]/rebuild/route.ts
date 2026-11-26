import { NextResponse, type NextRequest } from "next/server";
import { getLookbook } from "@/lib/db/repo";
import { compileKit } from "@/lib/ingest/compile";
import { getPricing, toInr } from "@/lib/llm/pricing";
import { modelsFor } from "@/lib/llm/router";
import { sse, err } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/** Estimated cost of rebuilding the kit (3 candidate kits + judge), shown to the user before they confirm. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lb = getLookbook(Number((await params).id)); if (!lb?.spec_json) return err("No spec to rebuild from", 404);
  const km = modelsFor("kit_strong"), price = /opus/i.test(km.openrouter) ? { in: 4, out: 20 } : /sonnet/i.test(km.openrouter) ? { in: 2, out: 10 } : (getPricing()[km.gemini] ?? { in: 1.25, out: 10 });
  const n = Number(process.env.KIT_CANDIDATES ?? 3), inTok = Math.ceil(lb.spec_json.length / 3.6) + 6500, outTok = 16000;
  const usd = (n * (inTok * price.in + outTok * price.out)) / 1e6 + 0.03;
  return NextResponse.json({ usd, inr: toInr(usd), candidates: n, model: km.openrouter, note: "Estimate: three candidate kits (about 16k output tokens each) plus scoring. One-time per look book version." });
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id), body = await req.json().catch(() => ({}));
  return sse(async (send) => { const r = await compileKit(id, (stage, detail) => send("progress", { stage, detail }), { reuse: !!body.reuse }); return { fidelity: r.score, warnings: r.warnings, costUsd: r.costUsd }; });
}
