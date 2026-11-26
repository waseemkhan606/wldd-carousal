import fs from "node:fs";
import path from "node:path";
import { getBrand, getLookbook, type Brand, type Lookbook } from "../db/repo";
import { getCarousel } from "../db/carousels";
import { StyleSpec } from "../ingest/spec";
import type { KitManifest } from "../ingest/kit";

export type Ctx = { lb: Lookbook; brand: Brand; spec: StyleSpec; manifest: KitManifest; kitDir: string };

export function loadCtx(lookbookId: number): Ctx {
  const lb = getLookbook(lookbookId);
  if (!lb || !lb.spec_json) throw new Error("This look book has not been ingested yet.");
  if (!lb.kit_path || !fs.existsSync(path.join(lb.kit_path, "manifest.json"))) throw new Error("This look book has no template kit. Rebuild the kit first.");
  const brand = getBrand(lb.brand_id)!;
  return { lb, brand, spec: StyleSpec.parse(JSON.parse(lb.spec_json)), manifest: JSON.parse(fs.readFileSync(path.join(lb.kit_path, "manifest.json"), "utf8")), kitDir: lb.kit_path };
}
export function loadCtxForCarousel(carouselId: number) {
  const c = getCarousel(carouselId);
  if (!c) throw new Error("Carousel not found");
  return { carousel: c, ctx: loadCtx(c.lookbook_id) };
}
