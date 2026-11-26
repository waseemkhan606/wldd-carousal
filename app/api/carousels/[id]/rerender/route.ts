import { NextResponse, type NextRequest } from "next/server";
import { rerenderCarousel } from "@/lib/generate/pipeline";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** Re-render all slides with the current templates (e.g. after a kit rebuild or spec edit). Free: no AI call. */
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await rerenderCarousel(Number((await params).id))); } catch (e) { return err(e, 500); }
}
