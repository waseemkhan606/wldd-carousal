// Re-render every archetype of a compiled kit with its sample copy (no LLM, free). tsx scripts/preview-cli.ts <slug> <outDir>
import fs from "node:fs"; import path from "node:path";
import { db } from "../lib/db";
import { renderSlide, closeBrowser } from "../lib/render/renderer";
(async () => {
  const [slug, out] = process.argv.slice(2);
  const lb = db().prepare("SELECT l.kit_path, l.spec_json FROM lookbooks l JOIN brands b ON b.id=l.brand_id WHERE b.slug=? AND l.is_active=1").get(slug) as any;
  const manifest = JSON.parse(fs.readFileSync(path.join(lb.kit_path, "manifest.json"), "utf8")); const spec = JSON.parse(lb.spec_json);
  fs.mkdirSync(out, { recursive: true });
  for (const a of manifest.archetypes) {
    const r = await renderSlide({ kitDir: lb.kit_path, manifest, archetypeId: a.id, slots: a.sample_slots, vars: { idx: 1, total: 5, handle: spec.brand.handle ?? "", brand: spec.brand.name } });
    fs.writeFileSync(path.join(out, a.id + ".png"), r.png);
    console.log(a.id.padEnd(18), r.problems.length ? r.problems.join(" | ") : "ok", Object.entries(r.diag.slots).map(([k, v]: any) => `${k}:${v.size}`).join(" "));
  }
  await closeBrowser();
})();
