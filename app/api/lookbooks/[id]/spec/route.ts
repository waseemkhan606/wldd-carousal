import { NextResponse, type NextRequest } from "next/server";
import { applySpecEdit } from "@/lib/ingest/respec";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
/** Save the edited Style Spec. Re-compiles variables/fonts/previews deterministically: no LLM, no cost. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await applySpecEdit(Number((await params).id), (await req.json()).spec)); }
  catch (e: any) { return err(e.issues ? e.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ") : e); }
}
