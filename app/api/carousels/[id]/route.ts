import { NextResponse, type NextRequest } from "next/server";
import { getCarousel, listSlides, deleteCarousel, carouselDir } from "@/lib/db/carousels";
import { getBrand } from "@/lib/db/repo";
import { costReport } from "@/lib/render/export";
import { err } from "@/lib/api";
import fs from "node:fs";
import { loadCtx } from "@/lib/generate/ctx";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: P) {
  const c = getCarousel(Number((await params).id));
  if (!c) return err("Carousel not found", 404);
  let kit: unknown = null;
  try { const ctx = loadCtx(c.lookbook_id); kit = { archetypes: ctx.manifest.archetypes.map((a) => ({ id: a.id, slots: a.slots })), brand: ctx.spec.brand.name }; } catch { /* kit gone: the viewer still works read-only */ }
  return NextResponse.json({ carousel: c, slides: listSlides(c.id), cost: costReport(c), kit });
}
export async function DELETE(_: NextRequest, { params }: P) {
  const c = getCarousel(Number((await params).id));
  if (!c) return err("Carousel not found", 404);
  const brand = getBrand(c.brand_id);
  deleteCarousel(c.id);
  if (brand) fs.rmSync(carouselDir(brand.slug, c.id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
