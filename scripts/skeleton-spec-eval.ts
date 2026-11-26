// Spec-driven skeleton on the three sample look books: coverage, measured fidelity (no model), and robustness to longer/shorter copy.
import fs from "node:fs/promises"; import path from "node:path"; import os from "node:os";
import { analyseLookbook } from "../lib/ingest/anatomy"; import { pdfInfo } from "../lib/ingest/pdf";
import { findFrames, extractGeometry, pickFrames, type PageGeometry } from "../lib/ingest/geometry";
import { fetchGoogleFont, fetchDevanagariPair } from "../lib/ingest/fonts"; import { StyleSpec } from "../lib/ingest/spec";
import { writeKit, validateKitStatic } from "../lib/ingest/kit"; import { skeletonKit } from "../lib/ingest/skeleton";
import { findLogoBox } from "../lib/ingest/logo"; import { renderSlide, closeBrowser } from "../lib/render/renderer"; import { measure } from "../lib/ingest/measure";
import { enforceFurniture, alignArchetype } from "../lib/ingest/autoalign";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
import { SPECS, slot } from "./eval-specs";
(async () => {
  const key = process.argv[2], pdf = path.resolve(`fixtures/${key} - sample look book.pdf`), out = path.join(os.tmpdir(), "skelspec-" + slug(key));
  const info = await pdfInfo(pdf), an = await analyseLookbook(pdf);
  await fs.rm(out, { recursive: true, force: true }); await fs.mkdir(path.join(out, "fonts"), { recursive: true });
  const css: string[] = [], fonts: any[] = [];
  for (const t of an.type) {
    const title = t.family.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()).replace(/\bIbm\b/, "IBM").replace(/\bDm\b/, "DM");
    const f = await fetchGoogleFont(title, t.weights.length ? t.weights : [400], path.join(out, "fonts")); if (f.css) css.push(f.css); else console.log("font missing", title);
    const d = await fetchDevanagariPair("Noto Sans Devanagari", [400], path.join(out, "fonts")); if (d.css) css.push(d.css);
    fonts.push({ role: slug(t.roles[0] ?? t.family), family: title, weights: f.weights.length ? f.weights : [400], devanagari_pair: "Noto Sans Devanagari" });
  }
  const colors = an.colours.map((c) => ({ token: slug(c.name), hex: c.hex, role: c.roles[0] ?? "colour" }));
  const d = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
  const near = (hex?: string) => hex ? [...colors].sort((a, b) => d(a.hex, hex) - d(b.hex, hex))[0].token : colors[0].token;
  const geo = new Map<string, PageGeometry>(); const arch: any[] = [];
  for (const [id, purpose, page, fi, slots] of SPECS[key]) {
    const frames = await findFrames(pdf, page, info); const f = frames[fi]; const g = await extractGeometry(pdf, page, info, f);
    if (g) geo.set(id, g); arch.push({ id, purpose, description: "", background_token: near(f.bg), slots: slots.map(slot), source_page: page });
  }
  const spec = StyleSpec.parse({ brand: { name: key, handle: "@" + slug(key) }, colors, fonts, elements: [], layout: { canvas: { w: 1080, h: 1350 }, margins_px: 60, grid_notes: "", fixed_furniture: [{ what: "slide counter", position: "top-right" }, { what: "logo", position: "bottom-right" }, { what: "handle", position: "bottom-left" }] }, archetypes: arch, voice: { summary: "", do: [], dont: [], examples: [] }, confidence: { overall: 1, low_confidence_fields: [] } });
  const first = [...geo.values()].find((g) => g.page === 5) ?? [...geo.values()][0];
  const lb = await findLogoBox(first, "bottom-right").catch(() => null);
  const t0 = Date.now(); const sk = await skeletonKit(spec, (id) => geo.get(id), lb ? { what: "logo", box: lb } : null);
  console.log(`covered ${sk.covered.length}/${spec.archetypes.length} in ${Date.now() - t0}ms; not covered: ${sk.notes.join(" | ") || "none"}`);
  const issues = validateKitStatic(sk.kit as any, { ...spec, archetypes: spec.archetypes.filter((a) => sk.covered.includes(a.id)) }); console.log("static issues:", issues.length ? issues : "none");
  const sub = { ...spec, archetypes: spec.archetypes.filter((a) => sk.covered.includes(a.id)) };
  const manifest = await writeKit(path.join(out, "kit"), sub, sk.kit as any, css.join("\n"), "skeleton-2");
  let tot = 0, n = 0, probs = { sample: 0, long: 0, short: 0 };
  for (const a of sub.archetypes) {
    const m = manifest.archetypes.find((x) => x.id === a.id)!;
    const run = (slots: Record<string, string>) => renderSlide({ kitDir: path.join(out, "kit"), manifest, archetypeId: a.id, slots, vars: { idx: 2, total: 5, handle: "@x", brand: key } });
    const r = await run(m.sample_slots); const sc = await measure(r.png, r.diag, geo.get(a.id)!);
    await fs.writeFile(path.join(out, `${a.id}.png`), r.png); await fs.writeFile(path.join(out, `${a.id}.ref.png`), geo.get(a.id)!.referencePng);
    const longS = Object.fromEntries(Object.entries(m.sample_slots).map(([k, v]) => [k, v + " " + v.split(" ").slice(0, Math.ceil(v.split(" ").length * 0.6)).join(" ")])), shortS = Object.fromEntries(Object.entries(m.sample_slots).map(([k, v]) => [k, v.split(" ").slice(0, Math.max(1, Math.floor(v.split(" ").length / 2))).join(" ")]));
    const rl = await run(longS), rs = await run(shortS);
    probs.sample += r.problems.length; probs.long += rl.problems.length; probs.short += rs.problems.length; tot += sc.score; n++;
    console.log(`${a.id.padEnd(13)} score ${sc.score.toFixed(1)} (layout ${sc.layout.toFixed(0)} pixel ${sc.pixel.toFixed(0)}) posErr ${sc.posErrPx.toFixed(0)}px | problems sample ${r.problems.length} long ${rl.problems.length} short ${rs.problems.length}${r.problems.length ? " :: " + r.problems[0].slice(0, 110) : ""}${rl.problems.length ? " || long: " + rl.problems[0].slice(0, 90) : ""}`);
    await fs.writeFile(path.join(out, `${a.id}.long.png`), rl.png);
  }
  console.log(`MEAN ${(tot / n).toFixed(1)} over ${n}; render problems sample ${probs.sample}, longer copy ${probs.long}, shorter copy ${probs.short}  → ${out}`);
  await closeBrowser();
})().catch((e) => { console.error(e); process.exit(1); });
