import { NextResponse, type NextRequest } from "next/server";
import { addLookbook } from "@/lib/db/repo";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
const MAX = 60 * 1024 * 1024;
/** Upload a look book PDF (multipart, field "file"). Ingest is started separately so progress can stream. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const f = (await req.formData()).get("file");
    if (!(f instanceof File)) return err("Attach the look book as a PDF file (field name: file).");
    if (f.size > MAX) return err("That PDF is over 60 MB.", 413);
    const lb = addLookbook(Number((await params).id), Buffer.from(await f.arrayBuffer()));
    return NextResponse.json({ lookbook: { id: lb.id, version: lb.version } });
  } catch (e) { return err(e); }
}
