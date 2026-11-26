// Does an instruction edit actually reach the final template? Real compile pipeline, stubbed model.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises"; import os from "node:os"; import path from "node:path";
process.env.DATA_DIR = path.join(os.tmpdir(), "cs-edit-eval-" + Date.now());
let editFn: (html: string) => string = (h) => h;
vi.mock("@/lib/llm/router", () => ({ llmCall: async (o: any) => { if (o.stage === "ingest.kit_edit") { const m = /### (\S+)\n[\s\S]*?```html\n([\s\S]*?)\n```/.exec(o.user)!; return { data: { archetypes: [{ id: m[1], html: editFn(m[2]) }], css_additions: "", summary: "stub edit" } }; } throw new Error("no model in this test"); } }));
vi.mock("@/lib/llm/preflight", () => ({ assertCredits: async () => {} }));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
describe("instruction edit", () => {
  it("an edit made to a template is present in the final, polished template", async () => {
    const { createBrand, addLookbook, lookbookDir, getLookbook } = await import("@/lib/db/repo");
    const { db } = await import("@/lib/db");
    const { analyseLookbook } = await import("@/lib/ingest/anatomy"); const { pdfInfo } = await import("@/lib/ingest/pdf");
    const { findFrames, extractGeometry, inkColor } = await import("@/lib/ingest/geometry"); const { fetchGoogleFont, fetchDevanagariPair } = await import("@/lib/ingest/fonts");
    const { StyleSpec } = await import("@/lib/ingest/spec"); const { skeletonFor } = await import("@/lib/ingest/skeleton");
    const { compileKit } = await import("@/lib/ingest/compile"); const { editTemplates } = await import("@/lib/ingest/kitedit");
    const sharp = (await import("sharp")).default;
    const pdfPath = path.resolve("fixtures/Brutal Dev - sample look book.pdf");
    const brand = createBrand("Eval"); const lb = addLookbook(brand.id, await fs.readFile(pdfPath));
    const dir = lookbookDir(brand.slug, lb.version), kitDir = path.join(dir, "kit");
    const info = await pdfInfo(lb.source_path), an = await analyseLookbook(lb.source_path);
    await fs.mkdir(path.join(dir, "fonts"), { recursive: true }); const css: string[] = []; const fonts: any[] = [];
    for (const t of an.type) { const fam = t.family.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()).replace(/\bIbm\b/, "IBM"); const f = await fetchGoogleFont(fam, t.weights.length ? t.weights : [400], path.join(dir, "fonts")); if (f.css) css.push(f.css); const d = await fetchDevanagariPair("Noto Sans Devanagari", [400], path.join(dir, "fonts")); if (d.css) css.push(d.css); fonts.push({ role: slug(t.roles[0] ?? t.family), family: fam, weights: f.weights.length ? f.weights : [400], devanagari_pair: "Noto Sans Devanagari" }); }
    await fs.writeFile(path.join(dir, "fonts", "fonts.css"), css.join("\n"));
    const colors = an.colours.map((c) => ({ token: slug(c.name), hex: c.hex, role: c.roles[0] ?? "colour" }));
    const d = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);
    const near = (hex?: string) => hex ? [...colors].sort((a, b) => d(a.hex, hex) - d(b.hex, hex))[0].token : colors[0].token;
    const base: any = { brand: { name: "T" }, colors, fonts, elements: [], layout: { canvas: { w: 1080, h: 1350 }, margins_px: 60, grid_notes: "", fixed_furniture: [] }, voice: { summary: "", do: [], dont: [], examples: [] }, confidence: { overall: 1, low_confidence_fields: [] } };
    const probe = StyleSpec.parse({ ...base, archetypes: [{ id: "x", purpose: "x", description: "", background_token: colors[0].token, slots: [{ name: "a", kind: "body", max_words: 4, max_chars: 20 }] }] });
    const sk: any[] = [];
    for (const p of an.pages.filter((p) => ["post", "carousel_cover"].includes(p.kind))) for (const [i, f] of (await findFrames(lb.source_path, p.page, info)).entries()) {
      const g = await extractGeometry(lb.source_path, p.page, info, f); if (!g?.words.length) continue;
      const raw = await sharp(g.referencePng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      sk.push({ id: `p${p.page}f${i + 1}`, page: p.page, bg: near(f.bg), s: skeletonFor(g, probe, near(f.bg), (b) => inkColor(raw.data, raw.info.width, b)) });
    }
    sk.push({ ...sk[1], id: "nogeo", page: undefined });
    const spec = StyleSpec.parse({ ...base, archetypes: sk.map((x) => ({ id: x.id, purpose: x.page === an.carousel?.coverPage ? "cover" : "sample", description: "", background_token: x.bg, slots: x.s.slots, ...(x.id === "nogeo" ? {} : { source_page: x.page }) })) });
    await fs.mkdir(kitDir, { recursive: true });
    await fs.writeFile(path.join(kitDir, "kit.raw.json"), JSON.stringify({ css: "[data-slot] em{font-style:inherit;font-weight:inherit}", archetypes: sk.map((x) => ({ id: x.id, html: x.s.html, sample_slots: x.s.sample_slots })) }));
    db().prepare("UPDATE lookbooks SET spec_json=?, status='spec_ready' WHERE id=?").run(JSON.stringify(spec), lb.id);

    await compileKit(lb.id, () => {}, { reuse: true });
    const finalHtml = async (id: string) => fs.readFile(path.join(kitDir, "archetypes", `${id}.html`), "utf8");
    const out: string[] = [];
    { const b4 = await finalHtml("nogeo"); editFn = (h) => h; await editTemplates(lb.id, { archetype: "nogeo", instruction: "change nothing really" }); const af = await finalHtml("nogeo"); out.push(`identity edit keeps the finished template as it was: ${af === b4 ? "YES" : "NO"}`); if (af !== b4) await fs.writeFile("/tmp/identity-diff.txt", b4 + "\n=====\n" + af); }

    const px = (h: string, slot: string, prop: string) => new RegExp(`data-slot="${slot}"[^>]*?${prop}:\\s*(-?[\\d.]+)`).exec(h)?.[1];
    const cases: [string, string, (h: string) => string, (h: string) => boolean][] = [
      ["size", "make the headline much smaller", (h) => h.replace(/(data-slot="headline"[^>]*?)font-size:\d+px/, "$1font-size:60px").replace(/(data-slot="headline"[^>]*?)data-max-size="\d+"/, '$1data-max-size="60"'), (h) => px(h, "headline", "font-size") === "60"],
      ["align", "centre the headline", (h) => h.replace(/(data-slot="headline"[^>]*?)text-align:\w+/, "$1text-align:center"), (h) => /data-slot="headline"[^>]*?text-align:center/.test(h)],
      ["move", "move the headline down 100px", (h) => h.replace(/(data-slot="headline"[^>]*?)top:(\d+)px/, (_m, a, t) => `${a}top:${Number(t) + 100}px`), (h) => true],
    ];
    for (const target of ["p3f1", "nogeo"]) for (const [name, instr, fn, ok] of cases) {
      const b4 = await finalHtml(target); editFn = fn;
      const asked = fn(b4);
      await editTemplates(lb.id, { archetype: target, instruction: instr });
      const af = await finalHtml(target);
      const kept = name === "move" ? px(af, "headline", "top") === px(asked, "headline", "top") : ok(af);
      out.push(`${target} ${name}: ${kept ? "KEPT" : "LOST"}  headline ${["font-size", "top", "text-align"].map((p) => p + "=" + (new RegExp(`data-slot="headline"[^>]*?${p}:\\s*([\\w.-]+)`).exec(af)?.[1])).join(" ")}  (before ${["font-size", "top", "text-align"].map((p) => p + "=" + (new RegExp(`data-slot="headline"[^>]*?${p}:\\s*([\\w.-]+)`).exec(b4)?.[1])).join(" ")})`);
    }
    await fs.writeFile("/tmp/edit-eval.txt", out.join("\n") + "\n\n" + (await fs.readFile(path.join(kitDir, "autoalign.log"), "utf8")));
    expect(out.filter((l) => /KEPT|YES|NO|LOST/.test(l)).every((l) => !/LOST|: NO/.test(l))).toBe(true);

  });
});
