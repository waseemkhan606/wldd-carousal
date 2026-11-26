import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { pixelCompare, measure } from "@/lib/ingest/measure";

const solid = (w: number, h: number, c: string, rects: { x: number; y: number; w: number; h: number; c: string }[] = []) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).composite(rects.map((r) => ({ input: { create: { width: r.w, height: r.h, channels: 3 as const, background: r.c } }, left: r.x, top: r.y }))).png().toBuffer();

describe("pixel metrics", () => {
  it("identical images score ~100; shifted content scores lower; wrong colour scores lower still", async () => {
    const a = await solid(1080, 1350, "#F4F1E8", [{ x: 150, y: 200, w: 700, h: 200, c: "#0E3B2E" }]);
    const same = await pixelCompare(a, a);
    const shifted = await pixelCompare(await solid(1080, 1350, "#F4F1E8", [{ x: 400, y: 600, w: 700, h: 200, c: "#0E3B2E" }]), a);
    const wrong = await pixelCompare(await solid(1080, 1350, "#0E3B2E"), a);
    expect(same.pixel).toBeGreaterThan(99);
    expect(shifted.pixel).toBeLessThan(same.pixel - 10);
    expect(wrong.pixel).toBeLessThan(shifted.pixel);
  });
});
describe("layout metrics", () => {
  const geo: any = { referencePng: null, words: [{ text: "Hello", x: 150, y: 200, w: 200, h: 60 }, { text: "world", x: 370, y: 200, w: 200, h: 60 }], lines: [{ text: "Hello world", x: 150, y: 200, w: 420, h: 60, color: "#FFFFFF", align: "left", estFontPx: 50 }], shapes: [] };
  const mk = async (dx: number, scale = 1) => {
    geo.referencePng = await solid(1080, 1350, "#FFFFFF");
    const diag: any = { words: [{ t: "Hello", n: "headline", x: 150 + dx, y: 200, w: 200 * scale, h: 60 * scale }, { t: "world", n: "headline", x: 370 + dx, y: 200, w: 200 * scale, h: 60 * scale }] };
    return measure(await solid(1080, 1350, "#FFFFFF"), diag, geo);
  };
  it("perfect placement: high layout score and no slot issues", async () => {
    const m = await mk(0); expect(m.layout).toBeGreaterThan(95); expect(m.issues.filter((i) => i.startsWith("slot"))).toEqual([]);
  });
  it("offset text produces an actionable numeric issue", async () => {
    const m = await mk(-60); expect(m.layout).toBeLessThan(90); expect(m.issues.join()).toMatch(/slot "headline".*dx=60px/);
  });
  it("text twice the size is reported", async () => {
    const m = await mk(0, 2); expect(m.issues.join()).toMatch(/block (width|height) should be/);
  });
  it("missing reference text is reported", async () => {
    geo.referencePng = await solid(1080, 1350, "#FFFFFF");
    const m = await measure(await solid(1080, 1350, "#FFFFFF"), { words: [] } as any, geo);
    expect(m.matched).toBe(0); expect(m.issues.join()).toMatch(/not present in your render/);
  });
});

import { editSlot, sanitizeHex, swapLogo } from "@/lib/ingest/autoalign";
describe("auto-align html edits", () => {
  const html = `<div class="s"><div data-slot="title" data-max-size="100" style="position:absolute;color:red" class="x">a</div></div>`;
  it("adds translate, merges existing style and replaces data attrs", () => {
    const o = editSlot(editSlot(html, "title", { addTranslate: [10, -5], style: { width: "300px" }, data: { "data-max-size": 80, "data-min-size": 40 } }), "title", { addTranslate: [2, 2] });
    expect(o).toContain("translate:12px -3px"); expect(o).toContain("width:300px"); expect(o).toContain("position:absolute"); expect(o).toContain('data-max-size="80"'); expect(o).toContain('data-min-size="40"');
  });
  it("leaves html alone for an unknown slot", () => expect(editSlot(html, "nope", { addTranslate: [1, 1] })).toBe(html));
});
describe("hex sanitiser", () => {
  const spec: any = { colors: [{ token: "ink", hex: "#112233" }, { token: "paper", hex: "#F4F1E8" }] };
  it("maps strays to the nearest variable, keeps :root and entities", () => {
    const r = sanitizeHex(":root{--c-ink:#112233} .a{color:#102030;background:#f5f2e9}", [`<p style="color:#fff">&#123;</p>`], spec);
    expect(r.css).toContain(":root{--c-ink:#112233}"); expect(r.css).toContain("color:var(--c-ink)"); expect(r.css).toContain("background:var(--c-paper)");
    expect(r.htmls[0]).toContain("var(--c-paper)"); expect(r.htmls[0]).toContain("&#123;");
  });
});

describe("aligner: line-height and tracking", () => {
  const geo: any = { words: [], lines: [{ text: "a b", x: 100, y: 100, w: 300, h: 50, color: "#FFFFFF", align: "left", estFontPx: 40 }, { text: "c d", x: 100, y: 200, w: 300, h: 50, color: "#FFFFFF", align: "left", estFontPx: 40 }], shapes: [] };
  const word = (t: string, x: number, y: number, w: number, n = "s") => ({ t, n, x, y, w, h: 50 });
  it("reports the reference line pitch and per-char tracking error", async () => {
    geo.words = [{ text: "alpha", x: 100, y: 100, w: 150, h: 50 }, { text: "beta", x: 270, y: 100, w: 120, h: 50 }, { text: "gamma", x: 100, y: 200, w: 150, h: 50 }, { text: "delta", x: 270, y: 200, w: 150, h: 50 }];
    geo.referencePng = await solid(1080, 1350, "#FFFFFF");
    // rendered: tighter words (width 125 for 5 chars = -5/char) and tighter line pitch (70 instead of 100)
    const diag: any = { words: [word("alpha", 100, 100, 125), word("beta", 270, 100, 100), word("gamma", 100, 170, 125), word("delta", 270, 170, 125)] };
    const m = await measure(await solid(1080, 1350, "#FFFFFF"), diag, geo);
    expect(m.slots.s.refPitch).toBeCloseTo(100, 0); expect(m.slots.s.gotPitch).toBeCloseTo(70, 0);
    expect(m.slots.s.wordTrack!).toBeGreaterThan(3);
  });
});

import { verticalLines, diffLines, verticalLineOverride, lineOpacity } from "@/lib/ingest/decor";
describe("decoration lines", () => {
  const withLine = (x: number) => solid(1080, 1350, "#F4F1E8", [{ x, y: 0, w: 3, h: 1350, c: "#D7442E" }]);
  it("detects a margin line and reports the shift between render and reference", async () => {
    const [r, g] = [await verticalLines(await withLine(120)), await verticalLines(await withLine(150))];
    expect(r).toHaveLength(1); expect(g).toHaveLength(1);
    expect(Math.round(r[0].x)).toBe(121); expect(diffLines(r, g)[0].dx).toBe(-30);
  });
  it("ignores slides without a line and text-like short marks", async () => {
    expect(await verticalLines(await solid(1080, 1350, "#F4F1E8", [{ x: 300, y: 100, w: 3, h: 200, c: "#000000" }]))).toEqual([]);
  });
  const css = `.el-ruled-paper::before { content:''; position:absolute; inset:0; background-image: repeating-linear-gradient(to bottom, transparent, transparent 53px, color-mix(in srgb, var(--c-x) 8%, transparent) 53px), linear-gradient(to right, transparent 149px, var(--c-red) 149px, var(--c-red) 151px, transparent 151px); }`;
  it("moves only the line gradient, scoped to one archetype", () => {
    const o = verticalLineOverride(css, 150, -30, "carousel-cover");
    expect(o).toContain('.el-ruled-paper[data-arch="carousel-cover"]::before'); expect(o).toContain("119px"); expect(o).toContain("121px");
    expect(o).toContain("repeating-linear-gradient(to bottom, transparent, transparent 53px"); // ruling untouched
  });
  it("moves a thin absolutely positioned element", () => {
    expect(verticalLineOverride(".rule { position:absolute; left: 150px; width: 2px; top:0; height:100%; }", 150, -30, "x")).toContain("left: 120px");
  });
  it("returns nothing when no rule draws a line there", () => expect(verticalLineOverride(css, 600, 10, "x")).toBe(""));
});

describe("line opacity", () => {
  it("recovers the fade of a lighter line", () => {
    const p = lineOpacity("#ECB4A4", "#D7442E", "#F4F1E8"); expect(p).toBeGreaterThan(0.3); expect(p).toBeLessThan(0.5);
    expect(lineOpacity("#D7442E", "#D7442E", "#F4F1E8")).toBe(1);
  });
  it("emits a colour-mix when faded", () => {
    expect(verticalLineOverride(".a::before { background-image: linear-gradient(to right, transparent 149px, var(--c-red) 149px, var(--c-red) 151px, transparent 151px); }", 150, -29, "x", 0.4)).toContain("color-mix(in srgb, var(--c-red) 40%, transparent)");
  });
});

describe("real logo swap", () => {
  const html = `<div class="slide"><div data-furniture="Logo" class="el-logo"><svg viewBox="0 0 10 10"><div></div></svg><div>x</div></div><div data-furniture="Tag">t</div></div>`;
  it("replaces the element's contents with the asset at the measured box, leaving siblings alone", () => {
    const o = swapLogo(html, "Logo", { x: 926, y: 1208, w: 80, h: 80 });
    expect(o).toContain('<img src="../assets/logo.png"'); expect(o).not.toContain("<svg"); expect(o).toContain("left:926px"); expect(o).toContain("width:80px"); expect(o).toContain('data-furniture="Tag">t</div>');
  });
  it("is idempotent and a no-op for unknown furniture", () => {
    const once = swapLogo(html, "Logo", { x: 1, y: 2, w: 3, h: 4 });
    expect((swapLogo(once, "Logo", { x: 1, y: 2, w: 3, h: 4 }).match(/logo\.png/g) ?? []).length).toBe(1);
    expect(swapLogo(html, "Nope", { x: 1, y: 2, w: 3, h: 4 })).toBe(html);
  });
});

import { enforceFurniture } from "@/lib/ingest/autoalign";
describe("written rules beat sample artwork (furniture)", () => {
  const spec: any = { layout: { margins_px: 80, fixed_furniture: [{ what: "slide_counter", position: "top-right" }, { what: "logo", position: "bottom-right" }] } };
  const html = `<div class="slide"><div data-furniture="slide_counter" style="position:absolute;left:90px;top:90px">1/5</div></div>`;
  it("moves furniture sitting on the wrong side to the stated edge, inside the margin", () => {
    const o = enforceFurniture(html, { furnitureMisplaced: ["slide_counter should be top-right but is not on the right side"], furnStats: { slide_counter: { rect: { x: 90, y: 90, w: 60, h: 24 } } } } as any, spec);
    expect(o.html).toContain("translate:850px 0px"); // right text edge lands at 1080-80 = 1000
    expect(o.changes[0]).toMatch(/moved to top-right/);
  });
  it("leaves correctly placed furniture alone", () => {
    expect(enforceFurniture(html, { furnitureMisplaced: [], furnStats: {} } as any, spec).html).toBe(html);
  });
});

import { fixContrast } from "@/lib/ingest/autoalign";
describe("fixContrast", () => {
  it("re-colours unreadable slot text", () => {
    const spec: any = { colors: [{ token: "paper", hex: "#FAFAFA" }, { token: "ink", hex: "#0A0A0A" }] };
    const h = '<div class="slide bg-paper"><div data-slot="headline" style="left:1px;color:var(--c-paper)"></div></div>';
    const r = fixContrast(h, spec);
    expect(r.html).toContain("var(--c-ink)"); expect(r.changes.length).toBe(1);
  });
});
