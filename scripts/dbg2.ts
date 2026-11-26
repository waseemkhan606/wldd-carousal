import fs from "node:fs"; import path from "node:path"; import { renderSlide, closeBrowser } from "../lib/render/renderer";
(async () => { const kitDir = process.argv[2], m = JSON.parse(fs.readFileSync(path.join(kitDir, "manifest.json"), "utf8"));
  const a = m.archetypes.find((x: any) => x.id === process.argv[3]); const r = await renderSlide({ kitDir, manifest: m, archetypeId: a.id, slots: a.sample_slots, vars: { idx: 1, total: 5, handle: "@x", brand: "B" } });
  console.log(JSON.stringify(r.diag.slots[process.argv[4]]), r.problems); await closeBrowser(); })();
