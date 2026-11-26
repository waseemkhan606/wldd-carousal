import { type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getLookbook } from "@/lib/db/repo";
export const dynamic = "force-dynamic";
/** Thumbnail: the first archetype preview if a kit exists, otherwise the PDF's first page. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lb = getLookbook(Number((await params).id)); if (!lb) return new Response("not found", { status: 404 });
  const cands: string[] = [];
  if (lb.kit_path) { const m = path.join(lb.kit_path, "previews"); if (fs.existsSync(m)) cands.push(...fs.readdirSync(m).sort().map((f) => path.join(m, f))); }
  const pages = path.join(path.dirname(lb.source_path), "pages"); if (fs.existsSync(pages)) cands.push(...fs.readdirSync(pages).sort().map((f) => path.join(pages, f)));
  const f = cands.find((c) => c.endsWith(".png"));
  return f ? new Response(fs.readFileSync(f), { headers: { "content-type": "image/png", "cache-control": "no-store" } }) : new Response("no image", { status: 404 });
}
