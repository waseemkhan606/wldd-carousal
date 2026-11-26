import { analyseLookbook } from "../lib/ingest/anatomy"; import { buildGuidelines } from "../lib/ingest/guidelines";
(async () => { const a = await analyseLookbook(process.argv[2]); const g = buildGuidelines(a);
  const by: Record<string, number> = {}; g.forEach((x) => (by[x.method] = (by[x.method] ?? 0) + 1));
  console.log(g.length, "guidelines", by);
  for (const x of g) console.log(`${x.id} p${x.page} [${x.method.padEnd(8)}|${x.category.padEnd(9)}|${x.scope.padEnd(8)}] ${x.check?.type ?? "-"}  ${x.statement}`); })();
