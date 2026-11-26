// Proves two brief requirements on a real generated carousel:
//  (6) regenerating one slide leaves every other slide's files byte-identical, and
//  (4) an inline text edit makes no LLM call (cost 0).
// DATA_DIR=... tsx scripts/regen-test.ts <carouselId> [slideIdx] ["instruction"]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../lib/db";
import { getBrand } from "../lib/db/repo";
import { getCarousel, listSlides, carouselDir } from "../lib/db/carousels";
import { regenerateSlide, editSlideText } from "../lib/generate/pipeline";
import { closeBrowser } from "../lib/render/renderer";
import { carouselCost } from "../lib/llm/usage";

const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 12);
const callCount = (id: number) => (db().prepare("SELECT COUNT(*) n FROM llm_calls WHERE carousel_id=?").get(id) as { n: number }).n;

async function main() {
  const id = Number(process.argv[2]), idx = Number(process.argv[3] ?? 3), instruction = process.argv[4] ?? "make it punchier";
  const c = getCarousel(id)!, dir = carouselDir(getBrand(c.brand_id)!.slug, id);
  const snap = () => Object.fromEntries(listSlides(id).flatMap((s) => [[`ig${s.idx}`, sha(path.join(dir, s.png_ig!))], [`li${s.idx}`, sha(path.join(dir, s.png_li!))], [`v${s.idx}`, String(s.version)]]));

  const before = snap(), callsBefore = callCount(id), costBefore = carouselCost(id).usd;
  const r = await regenerateSlide(id, idx, { instruction });
  const after = snap(), callsAfter = callCount(id), regenUsd = carouselCost(id).usd - costBefore;
  const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
  const expected = new Set([`ig${idx}`, `li${idx}`, `v${idx}`]);
  const stray = changed.filter((k) => !expected.has(k));
  console.log(`REGEN slide ${idx}: LLM calls +${callsAfter - callsBefore}, cost $${regenUsd.toFixed(5)} (Rs ${(regenUsd * 92.93).toFixed(3)}); changed: ${changed.join(", ")}`);
  console.log(stray.length ? `FAIL: other slides changed: ${stray.join(", ")}` : "PASS: every other slide's PNGs and versions are byte-identical");
  console.log(`      slide ${idx} IG changed: ${before[`ig${idx}`] !== after[`ig${idx}`]}, version ${before[`v${idx}`]} -> ${after[`v${idx}`]}; flags: ${JSON.stringify(r.flags[String(idx)] ?? [])}`);

  const other = listSlides(id).find((s) => s.idx !== idx)!;
  const copy = getCarousel(id)!.copy!, a = copy.slides.find((s) => s.idx === other.idx)!;
  const slot = Object.keys(a.slots)[0];
  const pre = callCount(id), preCost = carouselCost(id).usd, mid = snap();
  const e = await editSlideText(id, other.idx, { platform: "both", slot, text: a.slots[slot].toUpperCase().slice(0, 30) });
  const post = snap(), edited = Object.keys(mid).filter((k) => mid[k] !== post[k]);
  console.log(`EDIT slide ${other.idx} slot "${slot}": LLM calls +${callCount(id) - pre}, cost $${(carouselCost(id).usd - preCost).toFixed(5)}; files changed: ${edited.join(", ")}`);
  console.log(callCount(id) === pre && edited.every((k) => k.endsWith(String(other.idx))) ? "PASS: inline edit made no LLM call and touched only its own slide" : "FAIL");
  await closeBrowser();
}
main().catch(async (e) => { console.error("FAILED:", e.message); await closeBrowser(); process.exit(1); });
