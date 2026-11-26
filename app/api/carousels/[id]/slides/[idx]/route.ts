import { NextResponse, type NextRequest } from "next/server";
import { editSlideText } from "@/lib/generate/pipeline";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";

/** Inline text edit. Re-renders in code: no LLM, no cost. Body: {platform:"both"|"instagram"|"linkedin", slot, text} */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; idx: string }> }) {
  const { id, idx } = await params;
  const b = await req.json().catch(() => ({}));
  if (!["both", "instagram", "linkedin"].includes(b.platform)) return err("platform must be both, instagram or linkedin");
  try { return NextResponse.json(await editSlideText(Number(id), Number(idx), { platform: b.platform, slot: String(b.slot), text: String(b.text ?? "") })); }
  catch (e) { return err(e); }
}
