import { extractGeometry, describeGeometry } from "../lib/ingest/geometry";
import { pdfInfo } from "../lib/ingest/pdf";
import fs from "node:fs";
(async () => {
  const [pdf, page, out] = process.argv.slice(2);
  const info = await pdfInfo(pdf);
  const g = await extractGeometry(pdf, Number(page), info);
  if (!g) { console.log("no geometry"); return; }
  console.log("offsetY(pt)", g.offsetY, g.offsetMethod, "scale", g.scale.toFixed(3), "words", g.words.length, "lines", g.lines.length, "shapes", g.shapes.length);
  console.log(describeGeometry(g).slice(0, 1800));
  if (out) fs.writeFileSync(out, g.referencePng);
})();
