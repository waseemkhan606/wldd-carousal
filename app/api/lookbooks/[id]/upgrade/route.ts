import { NextResponse, type NextRequest } from "next/server";
import { upgradeLookbook } from "@/lib/ingest/guidelines";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
/** Re-read the look book PDF and rebuild its guideline register. Deterministic: no AI call, no cost. */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await upgradeLookbook(Number((await params).id))); } catch (e) { return err(e); }
}
