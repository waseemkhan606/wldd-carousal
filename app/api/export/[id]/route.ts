import { type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getCarousel, carouselDir } from "@/lib/db/carousels";
import { getBrand } from "@/lib/db/repo";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
const KINDS: Record<string, [string, string]> = {
  instagram_pdf: ["instagram.pdf", "application/pdf"], instagram_zip: ["instagram_pngs.zip", "application/zip"], linkedin_pdf: ["linkedin.pdf", "application/pdf"],
  captions: ["captions.txt", "text/plain; charset=utf-8"], cost: ["cost.json", "application/json"], all: ["everything.zip", "application/zip"],
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const c = getCarousel(Number((await params).id)); if (!c) return err("Carousel not found", 404);
  const kind = KINDS[req.nextUrl.searchParams.get("kind") ?? "all"]; if (!kind) return err(`kind must be one of ${Object.keys(KINDS).join(", ")}`);
  const file = path.join(carouselDir(getBrand(c.brand_id)!.slug, c.id), "export", kind[0]);
  if (!fs.existsSync(file)) return err("Export not built yet", 404);
  return new Response(fs.readFileSync(file), { headers: { "content-type": kind[1], "content-disposition": `attachment; filename="carousel-${c.id}-${kind[0]}"` } });
}
