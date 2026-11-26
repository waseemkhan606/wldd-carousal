import { evaluateChecklist } from "../lib/generate/checklist"; import { closeBrowser } from "../lib/render/renderer";
(async () => { const id = Number(process.argv[2]); const t0 = Date.now(); const c = await evaluateChecklist(id);
  console.log(JSON.stringify(c.summary), `${Date.now() - t0}ms`);
  for (const i of c.items) console.log(`${i.status.padEnd(7)} ${i.by.padEnd(8)} ${i.id} ${i.statement.slice(0, 58).padEnd(58)} | ${i.evidence.slice(0, 110)}`);
  await closeBrowser(); })().catch(async (e) => { console.error(e); await closeBrowser(); process.exit(1); });
