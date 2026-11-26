// Real compileKit on a look book whose spec lists every template: layout must come from the skeleton with NO model call for it.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises"; import os from "node:os"; import path from "node:path";
process.env.DATA_DIR = path.join(os.tmpdir(), "cs-skel-eval-" + Date.now());
const calls: string[] = [];
vi.mock("@/lib/llm/router", () => ({ llmCall: async (o: any) => {
  calls.push(o.stage);
  if (o.stage === "ingest.decor") return { data: { archetypes: [], css_additions: ".deco-ruled{position:absolute;inset:0}", summary: "stub decoration" } };
  throw new Error("no model for " + o.stage);
} }));
vi.mock("@/lib/llm/preflight", () => ({ assertCredits: async () => {} }));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
import { SPECS, slot } from "./eval-specs";
describe.each(Object.keys(SPECS))("ingest with the skeleton: %s", (KEY) => {
  it("builds every template from the PDF without a layout model call", async () => {
    calls.length = 0;
    const { createBrand, addLookbook, lookbookDir } = await import("@/lib/db/repo"); const { db } = await import("@/lib/db");
    const { analyseLookbook } = await import("@/lib/ingest/anatomy"); const { fetchGoogleFont, fetchDevanagariPair } = await import("@/lib/ingest/fonts");
    const { StyleSpec } = await import("@/lib/ingest/spec"); const { compileKit } = await import("@/lib/ingest/compile");
    const pdfPath = path.resolve(`fixtures/${KEY} - sample look book.pdf`);
    const brand = createBrand("Eval " + KEY); const lb = addLookbook(brand.id, await fs.readFile(pdfPath));
    const dir = lookbookDir(brand.slug, lb.version), an = await analyseLookbook(lb.source_path);
    await fs.mkdir(path.join(dir, "fonts"), { recursive: true }); const css: string[] = [], fonts: any[] = [];
    for (const t of an.type) { const fam = t.family.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()).replace(/\bIbm\b/, "IBM").replace(/\bDm\b/, "DM"); const f = await fetchGoogleFont(fam, t.weights.length ? t.weights : [400], path.join(dir, "fonts")); if (f.css) css.push(f.css); const d = await fetchDevanagariPair("Noto Sans Devanagari", [400], path.join(dir, "fonts")); if (d.css) css.push(d.css); fonts.push({ role: slug(t.roles[0] ?? t.family), family: fam, weights: f.weights.length ? f.weights : [400], devanagari_pair: "Noto Sans Devanagari" }); }
    await fs.writeFile(path.join(dir, "fonts", "fonts.css"), css.join("\n"));
    const colors = an.colours.map((c) => ({ token: slug(c.name), hex: c.hex, role: c.roles[0] ?? "colour" }));
    const { pdfInfo } = await import("@/lib/ingest/pdf"); const { findFrames } = await import("@/lib/ingest/geometry");
    const info = await pdfInfo(lb.source_path);
    const d3 = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
    const near = (hex?: string) => hex ? [...colors].sort((x, y) => d3(x.hex, hex) - d3(y.hex, hex))[0].token : colors[0].token;
    const archetypes: any[] = [];
    for (const [id, purpose, page, fi, slots] of SPECS[KEY]) { const fr = (await findFrames(lb.source_path, page, info))[fi]; archetypes.push({ id, purpose, description: "", background_token: near(fr.bg), source_page: page, slots: slots.map(slot) }); }
    const spec = StyleSpec.parse({
      brand: { name: KEY, handle: "@" + slug(KEY) }, colors, fonts,
      elements: [{ id: "ruled-lines", kind: "texture", description: "faint horizontal rules", css_hint: "", placement: "full bleed" }],
      layout: { canvas: { w: 1080, h: 1350 }, margins_px: 60, grid_notes: "", fixed_furniture: [{ what: "slide counter", position: "top-right" }, { what: "logo", position: "bottom-right" }, { what: "handle", position: "bottom-left" }] },
      archetypes, voice: { summary: "", do: [], dont: [], examples: [] }, confidence: { overall: 1, low_confidence_fields: [] },
    });
    db().prepare("UPDATE lookbooks SET spec_json=?, status='spec_ready' WHERE id=?").run(JSON.stringify(spec), lb.id);
    const rep = await compileKit(lb.id, (st, d) => console.log("  >", st, d ?? ""));
    const layoutCalls = calls.filter((c) => c === "ingest.kit" || c === "ingest.kit_repair");
    const lines = [`stages called: ${calls.join(", ") || "none"}`, `layout model calls: ${layoutCalls.length}`, `score ${rep.score.toFixed(1)} min ${rep.min.toFixed(1)}`, ...rep.repairs, ...rep.warnings.map((w) => "WARN " + w), "render problems: " + JSON.stringify(rep.renderProblems)];
    await fs.writeFile(`/tmp/ingest-skeleton-${slug(KEY)}.txt`, lines.join("\n") + "\nper template: " + JSON.stringify(Object.fromEntries(Object.entries(rep.perArchetype).map(([k, v]) => [k, Math.round(v.score)]))));
    expect(layoutCalls.length).toBe(0);
    expect(rep.score).toBeGreaterThan(75);
  });
});
