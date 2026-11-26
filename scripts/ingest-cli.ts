// Dev helper: ingest a PDF into a (throwaway or real) data dir and print the spec.
// Keys are read from env ONLY to seed the encrypted local store; they are never written elsewhere.
//   OPENROUTER_API_KEY=... GEMINI_API_KEY=... DATA_DIR=/tmp/x tsx scripts/ingest-cli.ts "Brand Name" file.pdf
import fs from "node:fs";
import { bootstrapAuth } from "../lib/auth/store";
import { setSetting } from "../lib/db/settings";
import { createBrand, addLookbook, listBrands, listLookbooks } from "../lib/db/repo";
import { ingestLookbook } from "../lib/ingest/run";
import { closeBrowser } from "../lib/render/renderer";
import { db } from "../lib/db";
import path from "node:path";

async function main() {
  const [name, pdf] = process.argv.slice(2);
  bootstrapAuth();
  if (process.env.OPENROUTER_API_KEY) setSetting("key.openrouter", process.env.OPENROUTER_API_KEY);
  if (process.env.GEMINI_API_KEY) setSetting("key.gemini", process.env.GEMINI_API_KEY);
  const existing = listBrands().find((b) => b.name === name);
  const lb = existing ? listLookbooks(existing.id)[0] : addLookbook(createBrand(name).id, fs.readFileSync(pdf)); // rerun resumes
  const r = await ingestLookbook(lb.id, (s, d) => console.error(`[${s}] ${d ?? ""}`));
  const out = process.env.OUT_DIR;
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    const kit = (db().prepare("SELECT kit_path FROM lookbooks WHERE id=?").get(lb.id) as any).kit_path as string;
    for (const f of fs.readdirSync(path.join(kit, "previews"))) fs.copyFileSync(path.join(kit, "previews", f), path.join(out, f));
    fs.mkdirSync(path.join(out, "compare"), { recursive: true });
    if (fs.existsSync(path.join(kit, "compare"))) for (const f of fs.readdirSync(path.join(kit, "compare"))) fs.copyFileSync(path.join(kit, "compare", f), path.join(out, "compare", f));
    fs.writeFileSync(path.join(out, "_report.json"), JSON.stringify({ warnings: r.warnings, kit: r.kit, costByStage: db().prepare("SELECT stage, model, COUNT(*) calls, SUM(in_tokens) inTok, SUM(out_tokens) outTok, ROUND(SUM(cost_usd),4) usd FROM llm_calls WHERE lookbook_id=? GROUP BY stage, model").all(lb.id), totalUsd: r.costUsd }, null, 1));
  }
  console.error("warnings:", r.warnings, "\ncost usd:", r.costUsd);
  await closeBrowser();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
