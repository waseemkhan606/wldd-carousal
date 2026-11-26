import fs from "node:fs/promises"; import path from "node:path"; import os from "node:os";
import { analyseLookbook } from "../lib/ingest/anatomy";
import { pdfInfo } from "../lib/ingest/pdf";
import { findFrames, extractGeometry, type PageGeometry } from "../lib/ingest/geometry";
import { fetchGoogleFont, fetchDevanagariPair } from "../lib/ingest/fonts";
import { StyleSpec } from "../lib/ingest/spec";
import { writeKit, validateKitStatic, colorVar } from "../lib/ingest/kit";
import { skeletonFor } from "../lib/ingest/skeleton";
import { renderSlide, closeBrowser } from "../lib/render/renderer";
import { measure } from "../lib/ingest/measure";
const pdf = process.argv[2], out = process.argv[3] ?? path.join(os.tmpdir(), "skel");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
(async () => {
  const info = await pdfInfo(pdf), an = await analyseLookbook(pdf);
  await fs.rm(out, { recursive: true, force: true }); await fs.mkdir(path.join(out, "fonts"), { recursive: true });
  const css: string[] = [];
  const fonts = [] as any[];
  for (const t of an.type) {
    const title = t.family.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase());
    let fam = title, f = await fetchGoogleFont(fam, t.weights.length ? t.weights : [400], path.join(out, "fonts"));
    if (!f.found) { fam = title.replace(/\bIbm\b/, "IBM").replace(/\bDm\b/, "DM"); f = await fetchGoogleFont(fam, t.weights.length ? t.weights : [400], path.join(out, "fonts")); if (!f.found) { fam = t.family; f = await fetchGoogleFont(fam, t.weights.length ? t.weights : [400], path.join(out, "fonts")); } }
    if (f.found) css.push(f.css); else console.log("font not found", t.family, f.error);
    const dev = await fetchDevanagariPair("Noto Sans Devanagari", f.weights.length ? f.weights : [400], path.join(out, "fonts")); if (dev.css) css.push(dev.css);
    fonts.push({ role: slug(t.roles[0] ?? t.family), family: fam, weights: f.weights.length ? f.weights : [400], devanagari_pair: "Noto Sans Devanagari" });
  }
  await fs.writeFile(path.join(out, "fonts", "fonts.css"), css.join("\n"));
  const colors = an.colours.map((c) => ({ token: slug(c.name), hex: c.hex, role: c.roles[0] ?? "colour" }));
  const near = (hex?: string) => hex ? [...colors].sort((a, b) => d(a.hex, hex) - d(b.hex, hex))[0].token : colors[0].token;
  const d = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
  const geos: { id: string; g: PageGeometry; bg: string; page: number }[] = [];
  for (const p of an.pages.filter((p) => ["post", "carousel_cover", "carousel_inside"].includes(p.kind))) {
    const frames = await findFrames(pdf, p.page, info);
    for (const [i, f] of frames.entries()) { const g = await extractGeometry(pdf, p.page, info, f); if (g && g.words.length) geos.push({ id: `p${p.page}f${i + 1}`, g, bg: near(f.bg), page: p.page }); }
  }
  const base: any = { brand: { name: "T" }, colors, fonts, elements: [], layout: { canvas: { w: 1080, h: 1350 }, margins_px: 60, grid_notes: "", fixed_furniture: [] }, archetypes: [], voice: { summary: "", do: [], dont: [], examples: [] }, confidence: { overall: 1, low_confidence_fields: [] } };
  const first = StyleSpec.parse({ ...base, archetypes: [{ id: "x", purpose: "x", description: "", background_token: colors[0].token, slots: [{ name: "a", kind: "body", max_words: 4, max_chars: 20 }] }] });
  const sharp = (await import("sharp")).default;
  const sk = [] as { x: typeof geos[0]; s: ReturnType<typeof skeletonFor> }[];
  for (const x of geos) {
    const raw = await sharp(x.g.referencePng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { inkColor } = await import("../lib/ingest/geometry");
    sk.push({ x, s: skeletonFor(x.g, first, x.bg, (b) => inkColor(raw.data, raw.info.width, b)) });
  }
  // slot "slide counter" furniture appears only on some archetypes; declare no furniture so every archetype validates
  const spec = StyleSpec.parse({ ...base, archetypes: sk.map(({ x, s }) => ({ id: x.id, purpose: "sample", description: "", background_token: x.bg, slots: s.slots.length ? s.slots : [{ name: "a", kind: "body", max_words: 4, max_chars: 20, optional: true }], source_page: x.page })) });
  const kit = { css: "[data-slot] em{font-style:inherit;font-weight:inherit}", archetypes: sk.map(({ x, s }) => ({ id: x.id, html: s.html, sample_slots: s.sample_slots })) };
  console.log("static issues:", validateKitStatic(kit as any, spec));
  const manifest = await writeKit(path.join(out, "kit"), spec, kit as any, css.join("\n"), "skeleton-1");
  let tot = 0;
  for (const { x, s } of sk) {
    const r = await renderSlide({ kitDir: path.join(out, "kit"), manifest, archetypeId: x.id, slots: manifest.archetypes.find((a) => a.id === x.id)!.sample_slots, vars: { idx: 2, total: 5, handle: "", brand: "T" } });
    const m = await measure(r.png, r.diag, x.g);
    await fs.writeFile(path.join(out, `${x.id}.png`), r.png); await fs.writeFile(path.join(out, `${x.id}.ref.png`), x.g.referencePng);
    tot += m.score;
    console.log(`${x.id} score ${m.score.toFixed(1)} layout ${m.layout.toFixed(1)} pixel ${m.pixel.toFixed(1)} matched ${(m.matched * 100).toFixed(0)}% posErr ${m.posErrPx.toFixed(1)}px size×${m.sizeRatio.toFixed(2)} problems ${r.problems.length}${r.problems.length ? " :: " + r.problems.slice(0, 3).join(" | ") : ""}`);
  }
  console.log("MEAN", (tot / sk.length).toFixed(1), "out", out);
  await closeBrowser();
})().catch((e) => { console.error(e); process.exit(1); });
