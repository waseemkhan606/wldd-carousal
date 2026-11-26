import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { analyseLookbook, readBlocks } from "@/lib/ingest/anatomy";
import { buildGuidelines, buildFormats, reconcileSpec, resolveColour } from "@/lib/ingest/guidelines";
import { StyleSpec } from "@/lib/ingest/spec";

const fx = (n: string) => path.resolve("fixtures", `${n} - sample look book.pdf`);
const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const NAMES = ["Small Print", "Brutal Dev", "Maison Lune"];

describe.each(NAMES)("guideline register for %s", (name) => {
  it("is grounded: every word of every quote appears on the guideline's own page of the PDF", async () => {
    const a = await analyseLookbook(fx(name));
    const { blocks } = await readBlocks(fx(name));
    const tokens = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const pageTokens = new Map<number, Set<string>>();
    for (const b of blocks) { const set = pageTokens.get(b.page) ?? pageTokens.set(b.page, new Set()).get(b.page)!; tokens(b.text).forEach((w) => set.add(w)); }
    const g = buildGuidelines(a);
    const synthetic = new Set(["palette_only", "format"]); // quotes assembled from several lines of a table
    const ungrounded = g.filter((x) => !synthetic.has(x.check?.type ?? "")).filter((x) => tokens(x.quote).some((w) => !pageTokens.get(x.page)?.has(w)));
    expect(ungrounded.map((x) => `${x.id} p${x.page}: ${x.quote}`)).toEqual([]);
  });

  it("covers every statement: all rule atoms, voice sentences, colours, fonts, elements, pillars", async () => {
    const a = await analyseLookbook(fx(name));
    const g = buildGuidelines(a);
    const count = (sec: string) => g.filter((x) => x.section === sec).length;
    expect(count("Carousel rules")).toBe(a.rules.flatMap((r) => r.atoms).length);
    expect(count("Voice")).toBe(a.voice!.sentences.length);
    expect(count("Brand colours")).toBe(a.colours.length + 1);
    expect(count("Type")).toBe(a.type.length);
    expect(count("Elements")).toBe(a.elements.length);
    expect(g.filter((x) => x.check?.type === "format")).toHaveLength(a.pillars.length);
    expect(new Set(g.map((x) => x.id)).size).toBe(g.length);
  });

  it("classifies each rule into something enforceable", async () => {
    const a = await analyseLookbook(fx(name));
    const types = buildGuidelines(a).filter((x) => x.section === "Carousel rules").map((x) => x.check?.type);
    for (const t of ["slide_role", "alternate_background", "caption_sources", "furniture_present", "max_words_per_slide", "max_elements_per_slide", "forbid_visual"]) expect(types).toContain(t);
    const roles = buildGuidelines(a).filter((x) => x.check?.type === "slide_role").map((x) => (x.check!.params as any).position);
    expect(roles).toEqual(["first", "middle", "last"]);
    const first = buildGuidelines(a).find((x) => x.check?.type === "slide_role" && (x.check.params as any).position === "first")!;
    expect((first.check!.params as any).requires.map((r: any) => r.kind).sort()).toEqual(["question", "stamp"]);
    const last = buildGuidelines(a).find((x) => x.check?.type === "slide_role" && (x.check.params as any).position === "last")!;
    expect((last.check!.params as any).requires.find((r: any) => r.kind === "phrase")?.text).toMatch(/save this/i);
  });

  it("resolves colours named in the rules to the brand palette", async () => {
    const a = await analyseLookbook(fx(name));
    const alt = buildGuidelines(a).find((x) => x.check?.type === "alternate_background");
    expect(alt?.method).toBe("code");
    const hexes = ((alt!.check!.params as any).colours as { hex: string }[]).map((c) => c.hex);
    expect(hexes).toHaveLength(2);
    for (const h of hexes) expect(a.colours.map((c) => c.hex)).toContain(h);
    expect(hexes[0]).not.toBe(hexes[1]);
  });

  it("builds one format per pillar and knows which are carousels", async () => {
    const a = await analyseLookbook(fx(name));
    const f = buildFormats(a);
    expect(f.map((x) => x.kind)).toEqual(["single", "single", "carousel", "carousel"]);
    expect(f.filter((x) => x.kind === "carousel").every((x) => x.slides === 5)).toBe(true);
    expect(f.find((x) => x.kind === "carousel" && /stamp|seal|sticker/i.test(x.description))).toBeTruthy();
  });
});

describe("resolveColour", () => {
  const a = { colours: [{ name: "LEDGER GREEN", hex: "#0E3B2E" }, { name: "COIN GOLD", hex: "#F2B33D" }, { name: "LEDGER PAPER", hex: "#F4F1E8" }] } as any;
  it("matches partial and plural wording but refuses ambiguity", () => {
    expect(resolveColour(a, "gold")?.hex).toBe("#F2B33D");
    expect(resolveColour(a, "green")?.hex).toBe("#0E3B2E");
    expect(resolveColour(a, "ledger paper")?.hex).toBe("#F4F1E8");
    expect(resolveColour(a, "ledger")).toBeNull();
    expect(resolveColour(a, "purple")).toBeNull();
  });
});

// needs a spec produced by a real ingest (samples/ is git-ignored), so it is skipped on a fresh clone
describe("reconcileSpec keeps the model's work and adds everything parsed", () => {
  it.skipIf(!fs.existsSync(path.resolve("samples/specs/small-print.spec.json")))("attaches names/roles, rules, formats and the register to a stored spec", async () => {
    const stored = JSON.parse(fs.readFileSync(path.resolve("samples/specs/small-print.spec.json"), "utf8"));
    const a = await analyseLookbook(fx("Small Print"));
    const spec = reconcileSpec(StyleSpec.parse(stored), a, { furniture: false });
    expect(spec.colors.map((c) => c.token)).toEqual(stored.colors.map((c: any) => c.token)); // kit variable names untouched
    expect(spec.colors.every((c) => c.name && c.roles.length)).toBe(true);
    expect(spec.fonts.some((f) => f.roles.length)).toBe(true);
    expect(spec.guidelines.length).toBe(40);
    expect(spec.formats).toHaveLength(4);
    expect(spec.voice.statements).toHaveLength(4);
    expect(spec.lookbook?.coverage?.mapped).toBe(spec.lookbook?.coverage?.blocks);
    expect(spec.rules.some((r) => r.machine?.type === "max_words_per_slide")).toBe(true);
    expect(StyleSpec.safeParse(spec).success).toBe(true);
  });
});

import { assignSourcePages } from "@/lib/ingest/guidelines";
describe("source pages come from the document anatomy, not the model", () => {
  it("maps cover, inside slides and single posts to their pages (the closer has none)", async () => {
    const a = await analyseLookbook(fx("Small Print"));
    const spec: any = { archetypes: [
      { id: "number-post", purpose: "Number post", source_page: 99 }, { id: "quiz-post", purpose: "Quick maths quiz" },
      { id: "carousel-cover", purpose: "cover" }, { id: "carousel-inside-paper", purpose: "body" }, { id: "carousel-closer", purpose: "closer" },
    ] };
    assignSourcePages(spec, a);
    const pg = Object.fromEntries(spec.archetypes.map((x: any) => [x.id, x.source_page]));
    expect(pg["carousel-cover"]).toBe(a.carousel!.coverPage);
    expect(pg["carousel-inside-paper"]).toBe(a.carousel!.insidePage);
    expect(pg["carousel-closer"]).toBeUndefined(); // the look book never draws the closing slide
    expect(pg["number-post"]).toBe(a.posts[0].page);
    expect(pg["quiz-post"]).toBe(a.posts[1].page);
  });
});
