import fs from "node:fs";
import path from "node:path";
import { db } from "./index";
import { DATA_DIR } from "../paths";

export type Brand = { id: number; name: string; slug: string; created_at: string };
export type Lookbook = { id: number; brand_id: number; version: number; is_active: number; source_path: string; spec_json: string | null; spec_user_edited: number; kit_path: string | null; fidelity_score: number | null; ingest_cost_json: string | null; status: string; created_at: string };

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "brand";
export const brandDir = (slug: string) => path.join(DATA_DIR, "brands", slug);
export const lookbookDir = (slug: string, version: number) => path.join(brandDir(slug), "lookbooks", String(version));

export function listBrands(): (Brand & { active_lookbook_id: number | null; fidelity_score: number | null; carousels: number })[] {
  return db().prepare(`SELECT b.*, (SELECT id FROM lookbooks WHERE brand_id=b.id AND is_active=1) active_lookbook_id,
    (SELECT fidelity_score FROM lookbooks WHERE brand_id=b.id AND is_active=1) fidelity_score,
    (SELECT COUNT(*) FROM carousels WHERE brand_id=b.id) carousels FROM brands b ORDER BY b.created_at DESC`).all() as any;
}
export const getBrand = (id: number) => db().prepare("SELECT * FROM brands WHERE id=?").get(id) as Brand | undefined;

export function createBrand(name: string): Brand {
  const clean = name.trim();
  if (!clean) throw new Error("Brand name is required");
  let slug = slugify(clean), i = 2;
  while (db().prepare("SELECT 1 FROM brands WHERE slug=?").get(slug)) slug = `${slugify(clean)}-${i++}`;
  try {
    const r = db().prepare("INSERT INTO brands(name,slug) VALUES(?,?)").run(clean, slug);
    return getBrand(Number(r.lastInsertRowid))!;
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) throw new Error(`A brand named "${clean}" already exists`);
    throw e;
  }
}

export function deleteBrand(id: number) {
  const b = getBrand(id);
  if (!b) return;
  db().prepare("DELETE FROM brands WHERE id=?").run(id); // cascades lookbooks, carousels, slides, calls
  fs.rmSync(brandDir(b.slug), { recursive: true, force: true });
}

export const listLookbooks = (brandId: number) => db().prepare("SELECT * FROM lookbooks WHERE brand_id=? ORDER BY version DESC").all(brandId) as Lookbook[];
export const getLookbook = (id: number) => db().prepare("SELECT * FROM lookbooks WHERE id=?").get(id) as Lookbook | undefined;

export function addLookbook(brandId: number, pdf: Buffer): Lookbook {
  const b = getBrand(brandId);
  if (!b) throw new Error("Brand not found");
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file is not a PDF");
  const version = ((db().prepare("SELECT MAX(version) v FROM lookbooks WHERE brand_id=?").get(brandId) as any).v ?? 0) + 1;
  const dir = lookbookDir(b.slug, version);
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "source.pdf");
  fs.writeFileSync(source, pdf);
  const first = version === 1;
  const r = db().prepare("INSERT INTO lookbooks(brand_id,version,is_active,source_path) VALUES(?,?,?,?)").run(brandId, version, first ? 1 : 0, source);
  return getLookbook(Number(r.lastInsertRowid))!;
}

export function setActive(lookbookId: number) {
  const lb = getLookbook(lookbookId);
  if (!lb) throw new Error("Look book not found");
  db().transaction(() => {
    db().prepare("UPDATE lookbooks SET is_active=0 WHERE brand_id=?").run(lb.brand_id);
    db().prepare("UPDATE lookbooks SET is_active=1 WHERE id=?").run(lookbookId);
  })();
}

export function deleteLookbook(lookbookId: number) {
  const lb = getLookbook(lookbookId);
  if (!lb) return;
  const all = listLookbooks(lb.brand_id);
  if (all.length <= 1) throw new Error("Can't delete a brand's last look book. Delete the brand instead.");
  const b = getBrand(lb.brand_id)!;
  db().prepare("DELETE FROM lookbooks WHERE id=?").run(lookbookId);
  fs.rmSync(lookbookDir(b.slug, lb.version), { recursive: true, force: true });
  if (lb.is_active) setActive(all.find((l) => l.id !== lookbookId)!.id);
}
