import { analyseLookbook } from "../lib/ingest/anatomy"; import { pdfInfo } from "../lib/ingest/pdf"; import { findFrames, extractGeometry } from "../lib/ingest/geometry";
import { toBlocks, classify } from "../lib/ingest/skeleton";
(async () => { const pdf = process.argv[2]; const info = await pdfInfo(pdf), an = await analyseLookbook(pdf);
  console.log("colours", an.colours.map((c) => c.name + " " + c.hex).join(" | ")); console.log("type", an.type.map((t) => t.family + " " + t.roles.join("/")).join(" | "));
  for (const p of an.pages.filter((p) => ["post", "carousel_cover", "carousel_inside"].includes(p.kind))) { const fr = await findFrames(pdf, p.page, info);
    for (const [i, f] of fr.entries()) { const g = await extractGeometry(pdf, p.page, info, f); if (!g) continue; console.log(`\n== p${p.page}f${i + 1} ${p.kind} bg ${f.bg}`);
      for (const b of classify(toBlocks(g.lines), g.shapes)) console.log(`  [${b.role.name || "static"}:${b.role.kind}] ${b.px}px y=${Math.round(b.y)} x=${Math.round(b.x)} ${b.boxed ? "boxed " : ""}"${b.text.slice(0, 60)}"`); } } })();
