import { type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getCarousel, listSlides, carouselDir } from "@/lib/db/carousels";
import { getBrand } from "@/lib/db/repo";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string; platform: string; idx: string }> }) {
  const { id, platform, idx } = await params;
  const c = getCarousel(Number(id)); if (!c) return err("Carousel not found", 404);
  const s = listSlides(c.id).find((x) => x.idx === Number(idx)); if (!s) return err("Slide not found", 404);
  const rel = platform === "linkedin" ? s.png_li : platform === "instagram" ? s.png_ig : null;
  if (!rel) return err("platform must be instagram or linkedin", 400);
  const file = path.join(carouselDir(getBrand(c.brand_id)!.slug, c.id), rel);
  return new Response(fs.readFileSync(file), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
