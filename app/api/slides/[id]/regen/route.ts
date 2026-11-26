import { NextResponse, type NextRequest } from "next/server";
import { getSlide } from "@/lib/db/carousels";
import { regenerateSlide } from "@/lib/generate/pipeline";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Regenerate one slide. Body: {instruction?, archetype?}. Other slides' files are not touched. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = getSlide(Number((await params).id));
  if (!s) return err("Slide not found", 404);
  const b = await req.json().catch(() => ({}));
  try { return NextResponse.json(await regenerateSlide(s.carousel_id, s.idx, { instruction: b.instruction, archetype: b.archetype })); }
  catch (e) { return err(e, 500); }
}
