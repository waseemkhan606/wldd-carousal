import { NextResponse, type NextRequest } from "next/server";
import { listLookbooks } from "@/lib/db/repo";
import { loadCtx } from "@/lib/generate/ctx";
import { estimateCost } from "@/lib/generate/plan";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";

/** Estimated cost of one carousel (both platforms) before generating. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams, brandId = Number(q.get("brandId")), n = Number(q.get("n") ?? 5), lang = (q.get("language") ?? "en") as "en" | "hi" | "hinglish";
  try {
    const lb = listLookbooks(brandId).find((l) => l.is_active) ?? listLookbooks(brandId)[0]; if (!lb) return err("Brand has no look book", 404);
    const c = loadCtx(lb.id);
    return NextResponse.json(await estimateCost(c.spec, c.manifest, q.get("topic") ?? "", n, lang, q.get("format") || undefined));
  } catch (e) { return err(e); }
}
