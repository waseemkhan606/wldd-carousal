// Free experiment: run the deterministic aligner on an already-compiled kit and report measured scores. DATA_DIR=... tsx scripts/align-cli.ts <slug> [outDir]
import fs from "node:fs"; import path from "node:path";
import { db } from "../lib/db";
import { StyleSpec } from "../lib/ingest/spec";
import { extractGeometry } from "../lib/ingest/geometry";
import { measure } from "../lib/ingest/measure";
import { alignArchetype } from "../lib/ingest/autoalign";
import { writeKit, type KitOutput } from "../lib/ingest/kit";
import { pdfInfo } from "../lib/ingest/pdf";
import { sideBySide } from "../lib/ingest/fidelity";
import { renderSlide, closeBrowser } from "../lib/render/renderer";
(async () => {
  const [slug, out] = process.argv.slice(2);
  const lb = db().prepare("SELECT l.* FROM lookbooks l JOIN brands b ON b.id=l.brand_id WHERE b.slug=? AND l.is_active=1").get(slug) as any;
  const spec = StyleSpec.parse(JSON.parse(lb.spec_json)); const kitDir = lb.kit_path as string; const dir = path.dirname(kitDir);
  const fontsCss = fs.readFileSync(path.join(dir, "fonts", "fonts.css"), "utf8");
  let kit: KitOutput = JSON.parse(fs.readFileSync(path.join(kitDir, "kit.source.json"), "utf8"));
  const info = await pdfInfo(lb.source_path); const geo = new Map<number, any>();
  for (const a of spec.archetypes) if (a.source_page && !geo.has(a.source_page)) geo.set(a.source_page, await extractGeometry(lb.source_path, a.source_page, info).catch(() => null));
  const evalKit = async (k: KitOutput) => {
    const m = await writeKit(kitDir, spec, k, fontsCss, "t"); const res: Record<string, any> = {};
    for (const a of m.archetypes) { const r = await renderSlide({ kitDir, manifest: m, archetypeId: a.id, slots: a.sample_slots, vars: { idx: 1, total: 5, handle: spec.brand.handle ?? "", brand: spec.brand.name } }); const sa = spec.archetypes.find((x) => x.id === a.id)!; const g = sa.source_page ? geo.get(sa.source_page) : null; res[a.id] = { r, g, m: g ? await measure(r.png, r.diag, g) : null }; }
    return res;
  };
  const show = (res: Record<string, any>) => Object.entries(res).map(([id, x]) => x.m ? `${id}=${x.m.score.toFixed(0)}(L${x.m.layout.toFixed(0)}/P${x.m.pixel.toFixed(0)})` : `${id}=n/a`).join("  ");
  let cur = await evalKit(kit); console.log("start :", show(cur));
  const mean = (r: any) => { const v = Object.values(r).map((x: any) => x.m?.score).filter((s: any) => s !== undefined); return v.reduce((a: number, b: number) => a + b, 0) / v.length; };
  const step = (k: KitOutput, res: Record<string, any>, mode: "shape" | "move") => { const nk: KitOutput = JSON.parse(JSON.stringify(k)); let n = 0; const log: string[] = []; for (const a of nk.archetypes) { const x = res[a.id]; if (!x?.m) continue; const r = alignArchetype(a.html, x.m, x.r.diag, spec, mode); a.html = r.html; n += r.changes.length; log.push(...r.changes.map((c) => `${a.id}/${c}`)); } return { nk, n, log }; };
  for (let cycle = 1; cycle <= 4; cycle++) {
    const s1 = step(kit, cur, "shape"); const e1 = s1.n ? await evalKit(s1.nk) : cur;
    const s2 = step(s1.nk, e1, "move"); if (!s1.n && !s2.n) break;
    const e2 = s2.n ? await evalKit(s2.nk) : e1;
    console.log(`cycle ${cycle}: shape ${s1.n} + move ${s2.n} ->`, show(e2), "| mean", mean(e2).toFixed(1), "(was", mean(cur).toFixed(1) + ")");
    if (mean(e2) > mean(cur) + 0.2) { cur = e2; kit = s2.nk; } else { cur = await evalKit(kit); break; }
  }
  if (out) { fs.mkdirSync(out, { recursive: true }); for (const [id, x] of Object.entries(cur) as any) { fs.writeFileSync(path.join(out, id + ".png"), x.r.png); if (x.g) fs.writeFileSync(path.join(out, id + ".compare.png"), await sideBySide(x.r.png, x.g.referencePng, 1000)); } }
  fs.writeFileSync(path.join(kitDir, "kit.source.aligned.json"), JSON.stringify(kit));
  await closeBrowser();
})();
