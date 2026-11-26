import path from "node:path";
import { db } from "./index";
import { brandDir, getBrand, getLookbook } from "./repo";

export type Lang = "en" | "hi" | "hinglish";
export type SlideCopy = { idx: number; archetype: string; slots: Record<string, string>; overrides?: { instagram?: Record<string, string>; linkedin?: Record<string, string> } };
export type Captions = { instagram: { text: string; hashtags: string[] }; linkedin: { text: string; hashtags: string[] } };
export type CopyData = { slides: SlideCopy[]; captions: Captions; sources_note?: string; format?: string; cover?: { considered: number; picked: number; angle?: string; reason: string } };
export type Flags = Record<string, string[]>; // slide idx -> human-readable issues the user can fix inline
export type ReviewCache = { at: string; hash: string; results: Record<string, { status: "pass" | "fail" | "unclear"; evidence: string; slides?: number[]; fix?: string }> };
export type RenderInfo = { slots: Record<string, { kind: string; ff: string; color: string; size: number; bg?: string; bd?: string }>; furniture: string[]; furnitureMisplaced: string[]; collisions: string[]; rootBg: string };
export type CarouselRow = { id: number; brand_id: number; lookbook_id: number; topic: string; n_slides: number; language: Lang; status: string; created_at: string; copy: CopyData | null; flags: Flags; review: ReviewCache | null };
export type SlideRow = { id: number; carousel_id: number; idx: number; archetype: string; png_ig: string | null; png_li: string | null; version: number };

export const carouselDir = (brandSlug: string, id: number) => path.join(brandDir(brandSlug), "carousels", String(id));

export function createCarousel(brandId: number, lookbookId: number, topic: string, n: number, language: Lang): number {
  return Number(db().prepare("INSERT INTO carousels(brand_id,lookbook_id,topic,n_slides,language,status) VALUES(?,?,?,?,?,'planning')").run(brandId, lookbookId, topic, n, language).lastInsertRowid);
}
export function getCarousel(id: number): CarouselRow | undefined {
  const r = db().prepare("SELECT * FROM carousels WHERE id=?").get(id) as any;
  if (!r) return undefined;
  return { ...r, copy: r.copy_json ? JSON.parse(r.copy_json) : null, flags: r.plan_json ? (JSON.parse(r.plan_json).flags ?? {}) : {}, review: r.plan_json ? (JSON.parse(r.plan_json).review ?? null) : null };
}
export function saveCopy(id: number, copy: CopyData, flags: Flags) {
  const prev = db().prepare("SELECT plan_json FROM carousels WHERE id=?").get(id) as { plan_json: string | null } | undefined;
  const review = prev?.plan_json ? JSON.parse(prev.plan_json).review : undefined; // keep the AI review across edits (it is marked stale by hash)
  db().prepare("UPDATE carousels SET copy_json=?, plan_json=? WHERE id=?").run(JSON.stringify(copy), JSON.stringify({ archetypes: copy.slides.map((s) => s.archetype), flags, review }), id);
}
export function saveReview(id: number, review: ReviewCache) {
  const prev = db().prepare("SELECT plan_json FROM carousels WHERE id=?").get(id) as { plan_json: string | null };
  const plan = prev.plan_json ? JSON.parse(prev.plan_json) : {};
  db().prepare("UPDATE carousels SET plan_json=? WHERE id=?").run(JSON.stringify({ ...plan, review }), id);
}
export function setRenderInfo(carouselId: number, idx: number, info: Partial<Record<"instagram" | "linkedin", RenderInfo>>) {
  db().prepare("UPDATE slides SET render_json=? WHERE carousel_id=? AND idx=?").run(JSON.stringify(info), carouselId, idx);
}
export const getRenderInfo = (carouselId: number): Record<number, Partial<Record<"instagram" | "linkedin", RenderInfo>>> =>
  Object.fromEntries((db().prepare("SELECT idx, render_json FROM slides WHERE carousel_id=?").all(carouselId) as { idx: number; render_json: string | null }[]).filter((r) => r.render_json).map((r) => [r.idx, JSON.parse(r.render_json!)]));
export const setStatus = (id: number, status: string) => db().prepare("UPDATE carousels SET status=? WHERE id=?").run(status, id);
export const listSlides = (carouselId: number) => db().prepare("SELECT id,carousel_id,idx,archetype,png_ig,png_li,version FROM slides WHERE carousel_id=? ORDER BY idx").all(carouselId) as SlideRow[];
export const getSlide = (id: number) => db().prepare("SELECT id,carousel_id,idx,archetype,png_ig,png_li,version FROM slides WHERE id=?").get(id) as SlideRow | undefined;
export function upsertSlide(carouselId: number, idx: number, archetype: string, pngIg: string, pngLi: string, overrides: unknown) {
  db().prepare(`INSERT INTO slides(carousel_id,idx,archetype,platform_overrides_json,png_ig,png_li,version) VALUES(?,?,?,?,?,?,1)
    ON CONFLICT(carousel_id,idx) DO UPDATE SET archetype=excluded.archetype, platform_overrides_json=excluded.platform_overrides_json, png_ig=excluded.png_ig, png_li=excluded.png_li, version=version+1`).run(carouselId, idx, archetype, JSON.stringify(overrides ?? null), pngIg, pngLi);
}
export const deleteCarousel = (id: number) => db().prepare("DELETE FROM carousels WHERE id=?").run(id);
export { getBrand, getLookbook };
