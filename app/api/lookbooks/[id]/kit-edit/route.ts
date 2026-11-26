import { NextResponse, type NextRequest } from "next/server";
import { editTemplates, editHistory, undoEdit } from "@/lib/ingest/kitedit";
import { sse, err } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
type P = { params: Promise<{ id: string }> };

/** What has been changed by instruction so far, and whether the last change can be undone. */
export async function GET(_: NextRequest, { params }: P) {
  try { return NextResponse.json(await editHistory(Number((await params).id))); } catch (e) { return err(e, 404); }
}

/** Change templates by instruction ({instruction, archetype?}) or undo the last change ({undo: true}). Streams progress. */
export async function POST(req: NextRequest, { params }: P) {
  const id = Number((await params).id), b = await req.json().catch(() => ({}));
  if (b.undo) return sse(async (send) => undoEdit(id, (stage, detail) => send("progress", { stage, detail })));
  if (typeof b.instruction !== "string" || b.instruction.trim().length < 4) return err("Write what should change.");
  return sse(async (send) => editTemplates(id, { archetype: typeof b.archetype === "string" ? b.archetype : undefined, instruction: b.instruction }, (stage, detail) => send("progress", { stage, detail })));
}
