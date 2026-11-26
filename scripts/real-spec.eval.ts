// Re-run compileKit locally with a spec downloaded from the live site (EVAL_SPEC=/path.json, EVAL_PDF=fixtures/...pdf).
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises"; import os from "node:os"; import path from "node:path";
process.env.DATA_DIR = path.join(os.tmpdir(), "cs-real-eval-" + Date.now());
const calls: string[] = [];
vi.mock("@/lib/llm/router", () => ({ llmCall: async (o: any) => { calls.push(o.stage); if (o.stage === "ingest.decor") return { data: { archetypes: [], css_additions: "", summary: "stub" } }; throw new Error("no model for " + o.stage); } }));
vi.mock("@/lib/llm/preflight", () => ({ assertCredits: async () => {} }));
describe("compile with a live spec", () => {
  it("scores", async () => {
    const { createBrand, addLookbook, lookbookDir } = await import("@/lib/db/repo"); const { db } = await import("@/lib/db");
    const { fetchGoogleFont, fetchDevanagariPair } = await import("@/lib/ingest/fonts"); const { StyleSpec } = await import("@/lib/ingest/spec"); const { compileKit } = await import("@/lib/ingest/compile");
    const spec = StyleSpec.parse(JSON.parse(await fs.readFile(process.env.EVAL_SPEC!, "utf8")));
    if (process.env.EVAL_FORCE_PAGE6) for (const a of spec.archetypes) if (!a.source_page) { a.source_page = 6; a.slots.forEach((x) => { x.optional = true; }); }
    const brand = createBrand("Real"), lb = addLookbook(brand.id, await fs.readFile(path.resolve(process.env.EVAL_PDF!)));
    const dir = lookbookDir(brand.slug, lb.version); await fs.mkdir(path.join(dir, "fonts"), { recursive: true }); const css: string[] = [];
    for (const f of spec.fonts) { const r = await fetchGoogleFont(f.google_fonts_family ?? f.family, f.weights, path.join(dir, "fonts")); if (r.css) css.push(r.css); const d = await fetchDevanagariPair(f.devanagari_pair, f.weights, path.join(dir, "fonts")); if (d.css) css.push(d.css); }
    await fs.writeFile(path.join(dir, "fonts", "fonts.css"), css.join("\n"));
    db().prepare("UPDATE lookbooks SET spec_json=?, status='spec_ready' WHERE id=?").run(JSON.stringify(spec), lb.id);
    const rep = await compileKit(lb.id, (s, d) => console.log("  >", s, d ?? ""));
    await fs.writeFile("/tmp/real-spec.txt", [`stages: ${calls.join(", ")}`, `score ${rep.score.toFixed(1)} min ${rep.min.toFixed(1)}`, ...rep.repairs, ...rep.warnings.map((w) => "WARN " + w), "problems " + JSON.stringify(Object.fromEntries(Object.entries(rep.renderProblems).filter(([, v]) => v.length))), "per " + JSON.stringify(Object.fromEntries(Object.entries(rep.perArchetype).map(([k, v]) => [k, Math.round(v.score)]))), "dir " + dir].join("\n"));
    expect(true).toBe(true);
  });
});
