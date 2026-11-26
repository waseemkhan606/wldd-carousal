// Score existing kit previews against the source pages (cheap judge only). tsx scripts/score-cli.ts <slug>
import fs from "node:fs"; import path from "node:path";
import { db } from "../lib/db";
import { scoreFidelity } from "../lib/ingest/fidelity";
import { renderForVision } from "../lib/ingest/spec";
(async () => {
  const slug = process.argv[2];
  const lb = db().prepare("SELECT l.id,l.kit_path,l.spec_json,l.source_path FROM lookbooks l JOIN brands b ON b.id=l.brand_id WHERE b.slug=? AND l.is_active=1").get(slug) as any;
  const spec = JSON.parse(lb.spec_json);
  for (const a of spec.archetypes) {
    if (!a.source_page) continue;
    const [ref] = await renderForVision(lb.source_path, [a.source_page], "/tmp/score-vision");
    const f = await scoreFidelity({ rendered: fs.readFileSync(path.join(lb.kit_path, "previews", a.id + ".png")), reference: ref, archetypeId: a.id, lookbookId: lb.id });
    console.log(a.id, f.score, JSON.stringify(f.checks)); f.diffs.forEach((d) => console.log("   -", d.area + ":", d.issue));
  }
})();
