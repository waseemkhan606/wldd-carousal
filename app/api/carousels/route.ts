import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { generateCarousel } from "@/lib/generate/pipeline";
import { err, sse } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brandId");
  const rows = db().prepare(`SELECT id,brand_id,topic,n_slides,language,status,created_at FROM carousels ${brand ? "WHERE brand_id=?" : ""} ORDER BY id DESC LIMIT 100`).all(...(brand ? [Number(brand)] : []));
  return NextResponse.json({ carousels: rows });
}

/** Streams progress as server-sent events; the final `result` event carries the carousel id. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const n = Number(b.nSlides), lang = b.language;
  const isSingle = b.single === true; // one-slide look book format (e.g. the quiz)
  if (!isSingle && (!Number.isInteger(n) || n < 3 || n > 10)) return err("nSlides must be 3 to 10");
  if (!["en", "hi", "hinglish"].includes(lang)) return err("language must be en, hi or hinglish");
  return sse((send) => generateCarousel({ brandId: Number(b.brandId), topic: String(b.topic ?? ""), n: isSingle ? 1 : n, language: lang, format: typeof b.format === "string" && b.format ? b.format : undefined }, (stage, detail) => send("progress", { stage, detail })));
}
