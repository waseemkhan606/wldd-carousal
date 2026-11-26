import { describe, it, expect } from "vitest";
import { skeletonForSpec, slotClass, furnKind, toBlocks, prepareLines } from "@/lib/ingest/skeleton";
import { validateKitStatic } from "@/lib/ingest/kit";
import { StyleSpec } from "@/lib/ingest/spec";

const L = (text: string, x: number, y: number, w: number, h: number, px: number, extra: any = {}) => ({ text, x, y, w, h, estFontPx: px, font: "Inter", color: "#111111", align: "left" as const, ...extra });
const geo = (lines: any[], words: any[] = [], shapes: any[] = []): any => ({ page: 1, scale: 1, offsetY: 0, offsetMethod: "svg-fill", words, lines, shapes, referencePng: Buffer.alloc(0) });
const spec = (slots: any[], furniture: any[] = []) => StyleSpec.parse({
  brand: { name: "T", handle: "@t" }, colors: [{ token: "bg", hex: "#FFFFFF", role: "bg" }, { token: "ink", hex: "#111111", role: "text" }],
  fonts: [{ role: "body", family: "Inter", weights: [400], devanagari_pair: "Noto Sans Devanagari" }], elements: [],
  layout: { canvas: { w: 1080, h: 1350 }, margins_px: 60, grid_notes: "", fixed_furniture: furniture },
  archetypes: [{ id: "a", purpose: "cover", description: "", background_token: "bg", slots }], voice: { summary: "", do: [], dont: [], examples: [] }, confidence: { overall: 1, low_confidence_fields: [] },
});
const slot = (name: string, kind: string, optional = false) => ({ name, kind, max_words: 20, max_chars: 120, optional });
const vis = () => undefined;

describe("skeleton kit from measured geometry", () => {
  const lines = [L("KICKER TEXT", 90, 90, 300, 30, 24), L("Big idea", 90, 300, 600, 140, 128), L("A supporting sentence that explains.", 90, 700, 800, 50, 36), L("01 / 05", 880, 90, 110, 30, 24)];
  it("maps slots by kind in reading order and builds a kit that passes the static rules", () => {
    const s = spec([slot("kicker", "tag"), slot("headline", "headline"), slot("subtitle", "body")], [{ what: "slide counter", position: "top-right" }]);
    const out: any = skeletonForSpec(geo(lines), s, s.archetypes[0], vis);
    expect(out.fail).toBeUndefined();
    expect(out.sample_slots).toEqual({ kicker: "KICKER TEXT", headline: "Big idea", subtitle: "A supporting sentence that explains." });
    expect(out.html).toContain('data-furniture="slide counter"');
    expect(out.html).toContain("{{idx}} / {{total}}");
    expect(validateKitStatic({ css: "x{}", archetypes: [{ id: "a", html: out.html, sample_slots: out.sample_slots }] }, s)).toEqual([]);
  });
  it('"subtitle" is body copy, not a headline', () => expect(slotClass({ name: "subtitle", kind: "body" })).toBe("body"));
  it("fails (so the model builds it) when a required slot has no counterpart in the sample", () => {
    const s = spec([slot("kicker", "tag"), slot("headline", "headline"), slot("quote_source", "tag")]);
    expect((skeletonForSpec(geo(lines.slice(0, 2)), s, s.archetypes[0], vis) as any).fail).toMatch(/quote_source/);
  });
  it("an optional slot with no counterpart still gets an element, inside the margins", () => {
    const s = spec([slot("kicker", "tag"), slot("headline", "headline"), slot("cta", "cta", true)]);
    const out: any = skeletonForSpec(geo(lines.slice(0, 2)), s, s.archetypes[0], vis);
    const m = /data-slot="cta"[^>]*left:(\d+)px;top:(\d+)px;width:(\d+)px;height:(\d+)px/.exec(out.html)!;
    expect(Number(m[1]) + Number(m[3])).toBeLessThanOrEqual(1020); expect(Number(m[2]) + Number(m[4])).toBeLessThanOrEqual(1290);
  });
  it("furniture the sample does not show starts hidden, at its stated corner", () => {
    const s = spec([slot("headline", "headline")], [{ what: "slide counter", position: "top-right" }]);
    const out: any = skeletonForSpec(geo([L("Only a headline", 90, 300, 700, 140, 128)]), s, s.archetypes[0], vis);
    expect(out.html).toMatch(/data-furniture="slide counter"[^>]*display:none/);
  });
  it("text that must not freeze into the template is dropped, tiny labels stay", () => {
    const s = spec([slot("headline", "headline")]);
    const out: any = skeletonForSpec(geo([L("Headline", 90, 300, 700, 140, 128), L("Some copy that is not a slot", 90, 600, 700, 50, 36), L("S", 930, 1190, 20, 40, 30)]), s, s.archetypes[0], vis);
    expect(out.html).not.toContain("Some copy");
    expect(out.html).toContain(">S<");
  });
  it("furnKind recognises counters, logos and handles", () => { expect(furnKind("slide counter")).toBe("counter"); expect(furnKind("brand logo mark")).toBe("logo"); expect(furnKind("account handle")).toBe("handle"); });
});

describe("text as the page really reads", () => {
  it("rebuilds letter-spaced words from gaps (only when the PDF marks them tracked)", () => {
    const w = (t: string, x: number) => ({ text: t, x, y: 100, w: 14, h: 30 });
    const words = [w("S", 100), w("A", 120), w("V", 140), w("E", 160), w("T", 200), w("H", 220), w("I", 240), w("S", 260)];
    const g = geo([L("S A V E T H I S", 100, 100, 175, 30, 30, { tracked: true })], words);
    expect(prepareLines(g)[0].text).toBe("SAVE THIS");
    const g2 = geo([L("60 sec x 2", 100, 100, 175, 30, 30)], words); // not marked tracked: left alone
    expect(prepareLines(g2)[0].text).toBe("60 sec x 2");
  });
  it("glues a currency sign split off by the PDF and merges its fragments", () => {
    const b = toBlocks([L("₹", 90, 300, 90, 140, 150), L("2,500", 190, 300, 500, 140, 150)]);
    expect(b).toHaveLength(1); expect(b[0].text).toBe("₹2,500");
  });
  it("puts a tilted stamp, stored letter by letter, back into one rotated line", () => {
    const px = 40, letters = "READTHIS".split("");
    const lines = letters.map((c, i) => L(c, 200 + i * 32, 700 + i * 2.2, 28, 44, px));
    const out = prepareLines(geo(lines));
    expect(out).toHaveLength(1); expect(out[0].text).toBe("READTHIS"); expect(out[0].rotationDeg).toBeGreaterThan(2);
  });
});
