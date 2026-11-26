import { NextResponse, type NextRequest } from "next/server";
import { evaluateChecklist, reviewCompliance } from "@/lib/generate/checklist";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type P = { params: Promise<{ id: string }> };

/** Live adherence checklist. Code and template checks are free and recomputed on every call (so inline edits show at once). */
export async function GET(_: NextRequest, { params }: P) {
  try { return NextResponse.json(await evaluateChecklist(Number((await params).id))); } catch (e) { return err(e, 404); }
}
/** Re-run the AI review of the guidelines code can't decide (tone, one idea per slide...). One small, cheap call. */
export async function POST(_: NextRequest, { params }: P) {
  const id = Number((await params).id);
  try { const r = await reviewCompliance(id); return NextResponse.json({ ...r, checklist: await evaluateChecklist(id) }); }
  catch (e) { return err(e, 502); }
}
