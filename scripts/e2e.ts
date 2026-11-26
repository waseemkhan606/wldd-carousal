// pnpm e2e: generates the assignment's test carousels with the Small Print look book and exports them to /samples.
// DATA_DIR=... pnpm e2e   (ingests fixtures/Small Print - sample look book.pdf first if the brand doesn't exist;
// needs an OpenRouter key saved in Settings, or OPENROUTER_API_KEY / GEMINI_API_KEY in the environment to seed it).
import fs from "node:fs";
import path from "node:path";
import { bootstrapAuth } from "../lib/auth/store";
import { setSetting } from "../lib/db/settings";
import { db } from "../lib/db";
import { createBrand, addLookbook, listBrands } from "../lib/db/repo";
import { ingestLookbook } from "../lib/ingest/run";
import { generateCarousel } from "../lib/generate/pipeline";
import { getCarousel, listSlides, carouselDir } from "../lib/db/carousels";
import { carouselCost } from "../lib/llm/usage";
import { renderStats, closeBrowser } from "../lib/render/renderer";
import { evaluateChecklist } from "../lib/generate/checklist";

const CUSTOM = process.env.E2E_TOPIC ? [{ name: "custom", topic: process.env.E2E_TOPIC, n: Number(process.env.E2E_N ?? 5), language: "en" as const }] : null;
const JOBS = CUSTOM ?? [
  { name: "en-7", topic: "5 money habits to start with your first salary", n: 7, language: "en" as const },
  { name: "hinglish-5", topic: "Credit card ka interest-free period kaise kaam karta hai", n: 5, language: "hinglish" as const },
  { name: "hindi-5", topic: "सैलरी आने के बाद पहले तीन काम: इमरजेंसी फंड, SIP और बीमा", n: 5, language: "hi" as const },
];

async function main() {
  bootstrapAuth();
  if (process.env.OPENROUTER_API_KEY) setSetting("key.openrouter", process.env.OPENROUTER_API_KEY);
  if (process.env.GEMINI_API_KEY) setSetting("key.gemini", process.env.GEMINI_API_KEY);
  const BRAND = process.env.E2E_BRAND ?? "Small Print";
  let brand = listBrands().find((b) => b.name === BRAND);
  if (!brand) {
    const pdf = path.resolve("fixtures", `${BRAND} - sample look book.pdf`);
    console.log(`Ingesting ${pdf} (one-time)...`);
    const b = createBrand(BRAND);
    const lb = addLookbook(b.id, fs.readFileSync(pdf));
    await ingestLookbook(lb.id, (s, d) => console.log(`  [${s}] ${d ?? ""}`));
    brand = listBrands().find((x) => x.id === b.id)!;
  }
  const out = path.resolve("samples", brand.slug);
  const rows: any[] = [];
  for (const j of JOBS) {
    console.log(`\n== ${j.name}: ${j.topic}`);
    const t0 = Date.now();
    const r = await generateCarousel({ brandId: brand.id, topic: j.topic, n: j.n, language: j.language }, (s, d) => console.log(`  [${s}] ${d ?? ""}`));
    const c = getCarousel(r.carouselId)!, cost = carouselCost(r.carouselId);
    const dir = carouselDir(brand.slug, r.carouselId);
    const dest = path.join(out, j.name);
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(dir, "export"), path.join(dest, "export"), { recursive: true, force: true });
    fs.cpSync(path.join(dir, "ig"), path.join(dest, "instagram_slides"), { recursive: true, force: true });
    fs.cpSync(path.join(dir, "li"), path.join(dest, "linkedin_slides"), { recursive: true, force: true });
    fs.writeFileSync(path.join(dest, "copy.json"), JSON.stringify(c.copy, null, 2));
    const cl = await evaluateChecklist(r.carouselId);
    fs.writeFileSync(path.join(dest, "checklist.json"), JSON.stringify(cl, null, 2));
    console.log(`  checklist: ${cl.summary.followed}/${cl.summary.applicable} followed, ${cl.summary.fail} to fix, ${cl.summary.pending} undecided. ` + cl.items.filter((x) => x.status === "fail").map((x) => `FAIL "${x.statement}": ${x.evidence}`).join(" | "));
    const calls = db().prepare("SELECT stage, provider, model, fallback_used, ok FROM llm_calls WHERE carousel_id=?").all(r.carouselId) as any[];
    rows.push({
      name: j.name, id: r.carouselId, slides: listSlides(r.carouselId).length, usd: cost.usd, inr: cost.inr, repairs: r.repairs,
      flagged: Object.keys(r.flags).length, cover: c.copy?.cover, fallback: calls.filter((x) => x.fallback_used).length, calls: calls.length,
      secs: Math.round((Date.now() - t0) / 1000), stages: cost.rows.map((x) => `${x.stage} ${x.model.split("/").pop()} $${x.usd.toFixed(4)}`),
    });
    if (Object.keys(r.flags).length) console.log("  flagged:", JSON.stringify(r.flags));
  }
  console.log("\n==== E2E SUMMARY ====");
  for (const r of rows) {
    console.log(`${r.name.padEnd(11)} carousel #${r.id}: ${r.slides} slides | $${r.usd.toFixed(4)} = Rs ${r.inr.toFixed(2)} | LLM calls ${r.calls} (repair rounds ${r.repairs}, provider fallbacks ${r.fallback}) | flagged slides ${r.flagged} | ${r.secs}s`);
    console.log(`            ${r.stages.join(" | ")}`);
    if (r.cover) console.log(`            cover: picked #${r.cover.picked} of ${r.cover.considered} (${r.cover.angle}): ${r.cover.reason}`);
  }
  console.log(`Text-integrity: ${renderStats.renders} slide renders, ${renderStats.integrityChecks} slot checks, ${renderStats.integrityFailures} failures.`);
  console.log(`Exports in ${out}`);
  await closeBrowser();
}
main().catch(async (e) => { console.error("E2E FAILED:", e.message); await closeBrowser(); process.exit(1); });
