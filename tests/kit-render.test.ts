import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { validateKitStatic, writeKit, type KitOutput } from "@/lib/ingest/kit";
import { combine } from "@/lib/ingest/fidelity";
import { renderSlide, closeBrowser, pngSize } from "@/lib/render/renderer";

const spec: any = {
  brand: { name: "T" }, colors: [{ token: "bg", hex: "#112233", role: "background", usage_notes: "" }, { token: "ink", hex: "#EEEEEE", role: "text", usage_notes: "" }],
  fonts: [{ role: "display", family: "NoSuchFontZ", weights: [400], devanagari_pair: "NoSuchDevaZ", substituted: false }],
  elements: [], layout: { canvas: { w: 1080, h: 1350 }, margins_px: 60, grid_notes: "", fixed_furniture: [{ what: "counter", position: "top-right" }] },
  archetypes: [{ id: "a1", purpose: "cover", description: "", background_token: "bg", slots: [{ name: "title", kind: "headline", max_words: 8, max_chars: 60, optional: false }, { name: "note", kind: "body", max_words: 20, max_chars: 120, optional: true }] }],
  sequencing: [], rules: [], voice: { summary: "", do: [], dont: [], examples: [] }, confidence: { overall: 1, low_confidence_fields: [] },
};
const goodHtml = `<div class="slide" style="position:relative;width:1080px;height:1350px;background:var(--c-bg)">
  <div data-furniture="counter" style="position:absolute;top:60px;right:60px;color:var(--c-ink)">{{idx}} / {{total}}</div>
  <div data-slot="title" data-max-size="200" data-min-size="40" style="position:absolute;left:60px;top:300px;width:960px;height:300px;color:var(--c-ink);font-size:200px;line-height:1.05">x</div>
  <div data-slot="note" style="position:absolute;left:60px;top:900px;width:400px;height:60px;color:var(--c-ink);font-size:30px">y</div></div>`;
const kit = (html = goodHtml, css = ".slide{font-family:sans-serif}"): KitOutput => ({ css, archetypes: [{ id: "a1", html, sample_slots: { title: "Hello", note: "n" } }] });

describe("kit static validation", () => {
  it("accepts a clean kit", () => expect(validateKitStatic(kit(), spec)).toEqual([]));
  it("rejects hex colours in css and html", () => {
    expect(validateKitStatic(kit(goodHtml, ".a{color:#ff0000}"), spec).join()).toMatch(/hex/);
    expect(validateKitStatic(kit(goodHtml.replace("var(--c-bg)", "#123456")), spec).join()).toMatch(/hex/);
  });
  it("allows hex inside :root only", () => expect(validateKitStatic(kit(goodHtml, ":root{--x:#fff} .a{color:var(--x)}"), spec)).toEqual([]));
  it("rejects scripts, handlers, external urls", () => {
    for (const bad of [`<script>1</script>`, `<div onclick="x()"></div>`, `<img src="https://x.com/a.png">`]) {
      expect(validateKitStatic(kit(goodHtml + bad), spec).length).toBeGreaterThan(0);
    }
    expect(validateKitStatic(kit(goodHtml, "@import url(https://x.com/a.css);"), spec).length).toBeGreaterThan(0);
  });
  it("requires every slot and furniture", () => {
    expect(validateKitStatic(kit(goodHtml.replace('data-slot="title"', 'data-slot="oops"')), spec).join()).toMatch(/title/);
    expect(validateKitStatic(kit(goodHtml.replace('data-furniture="counter"', "")), spec).join()).toMatch(/counter/);
  });
});

describe("fidelity combiner", () => {
  it("one bad category drags the score below the plain average", () => {
    const c = { background: 100, colour_usage: 100, typography: 100, alignment_spacing: 40, decor_elements: 100, furniture: 100 };
    expect(combine(c)).toBeLessThan(Math.round((500 + 40) / 6));
  });
});

describe("render engine", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-"));
  const run = async (slots: Record<string, string>) => {
    const manifest = await writeKit(dir, spec, kit(), "", "t");
    // fonts don't exist in this synthetic kit, so skip the font-load check by clearing families
    manifest.families = { latin: [], devanagari: [] };
    return renderSlide({ kitDir: dir, manifest, archetypeId: "a1", slots, vars: { idx: 2, total: 7 } });
  };
  afterAll(() => closeBrowser());

  it("renders exactly 1080x1350 and fills furniture placeholders", async () => {
    const r = await run({ title: "Hi", note: "" });
    expect(pngSize(r.png)).toEqual({ w: 1080, h: 1350 });
    expect(r.diag.furniture).toEqual(["counter"]); expect(r.diag.furnitureMisplaced).toEqual([]);
    expect(r.problems).toEqual([]);
  });
  it("keeps designed size when text fits, shrinks when it doesn't", async () => {
    expect((await run({ title: "Hi", note: "" })).diag.slots.title.size).toBe(200);
    const long = await run({ title: "A considerably longer headline that cannot fit at two hundred pixels", note: "" });
    expect(long.diag.slots.title.size).toBeLessThan(200); expect(long.diag.slots.title.size).toBeGreaterThanOrEqual(40);
  });
  it("flags overflow when even the minimum size can't hold the text", async () => {
    const r = await run({ title: "word ".repeat(300), note: "" });
    expect(r.problems.join()).toMatch(/OVERFLOW: slot "title"/);
  });
  it("treats text as text: markup stays literal and DOM text equals the input byte for byte", async () => {
    const evil = `<img src=x onerror=alert(1)> & "q" ₹100 क्ष त्र`;
    const r = await run({ title: evil, note: "" });
    expect(r.diag.slots.title.textOk).toBe(true);
    expect(r.problems.filter((p) => p.startsWith("TEXT_INTEGRITY"))).toEqual([]);
  });
  it("fails loudly when a declared font family cannot load", async () => {
    const manifest = await writeKit(dir, spec, kit(), "", "t"); // families now include NoSuchFontZ (no @font-face)
    const r = await renderSlide({ kitDir: dir, manifest, archetypeId: "a1", slots: { title: "Hi" }, vars: { idx: 1, total: 1 } });
    expect(r.problems.join()).toMatch(/FONT_LOAD: .*NoSuchFontZ/);
  });
});

describe("render engine: safe area + collisions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit2-"));
  afterAll(() => closeBrowser());
  const html = `<div class="slide" style="position:relative;width:1080px;height:1350px;background:var(--c-bg)">
    <div data-slot="title" data-max-size="260" data-min-size="40" style="position:absolute;left:0;top:300px;width:1080px;height:300px;color:var(--c-ink);font-size:260px;line-height:1;white-space:nowrap;text-align:center">x</div>
    <div data-slot="note" style="position:absolute;left:400px;top:330px;width:500px;height:60px;color:var(--c-ink);font-size:30px">y</div>
    <div data-furniture="counter" style="position:absolute;top:60px;right:60px;color:var(--c-ink)">{{idx}}</div></div>`;
  const go = async (slots: Record<string, string>) => {
    const manifest = await writeKit(dir, spec, { css: ".slide{font-family:sans-serif}", archetypes: [{ id: "a1", html, sample_slots: {} }] }, "", "t");
    manifest.families = { latin: [], devanagari: [] };
    return renderSlide({ kitDir: dir, manifest, archetypeId: "a1", slots, vars: { idx: 1, total: 1 } });
  };
  it("shrinks text so it stays inside the margins even when its box spans the full width", async () => {
    const r = await go({ title: "₹36,500 every single year", note: "" });
    expect(r.diag.slots.title.size).toBeLessThan(260);
    expect(r.problems.filter((p) => p.startsWith("OVERFLOW"))).toEqual([]);
  });
  it("reports overlapping text between slots", async () => {
    const r = await go({ title: "Hi", note: "overlap me please" }); // note sits inside the title's line box
    expect(r.problems.join()).toMatch(/COLLISION/);
  });
});

describe("collisions ignore nesting", () => {
  it("a furniture wrapper containing its own slot is not a collision", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit3-"));
    const html = `<div class="slide" style="position:relative;width:1080px;height:1350px"><div data-furniture="counter" style="position:absolute;top:60px;left:100px;color:var(--c-ink)"><span data-slot="title" style="font-size:30px;display:block;width:300px;height:40px">x</span></div></div>`;
    const manifest = await writeKit(dir, spec, { css: ".slide{font-family:sans-serif}", archetypes: [{ id: "a1", html, sample_slots: {} }] }, "", "t");
    manifest.families = { latin: [], devanagari: [] };
    const r = await renderSlide({ kitDir: dir, manifest, archetypeId: "a1", slots: { title: "Nested" }, vars: { idx: 1, total: 1 } });
    expect(r.problems.filter((p) => p.startsWith("COLLISION"))).toEqual([]);
    await closeBrowser();
  });
});

describe("inline emphasis", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit4-"));
  afterAll(() => closeBrowser());
  const html = `<div class="slide" style="position:relative;width:1080px;height:1350px"><div data-slot="title" data-max-size="60" data-min-size="20" style="position:absolute;left:100px;top:300px;width:800px;height:200px;font-size:60px">x</div></div>`;
  const go = async (t: string) => {
    const manifest = await writeKit(dir, spec, { css: "[data-slot] em{font-style:italic}", archetypes: [{ id: "a1", html, sample_slots: {} }] }, "", "t");
    manifest.families = { latin: [], devanagari: [] };
    return renderSlide({ kitDir: dir, manifest, archetypeId: "a1", slots: { title: t }, vars: { idx: 1, total: 1 } });
  };
  it("*word* becomes an em and integrity holds against the marker-free text", async () => {
    const r = await go("Cleanse like *you mean it*");
    expect(r.diag.slots.title.textOk).toBe(true);
    expect(r.problems.filter((p) => p.startsWith("TEXT_INTEGRITY"))).toEqual([]);
  });
  it("lone asterisks and maths are left alone", async () => {
    const r = await go("2 * 3 * 4 = 24");
    expect(r.diag.slots.title.textOk).toBe(true);
  });
  it("markup inside emphasis stays literal text", async () => {
    const r = await go("*<b>x</b>*");
    expect(r.diag.slots.title.textOk).toBe(true);
  });
});

describe("ink check", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit5-"));
  afterAll(() => closeBrowser());
  const go = async (inner: string, css = "") => {
    const html = `<div class="slide" style="position:relative;width:1080px;height:1350px;background:var(--c-bg)">${inner}</div>`;
    const manifest = await writeKit(dir, spec, { css: ".slide{font-family:sans-serif}" + css, archetypes: [{ id: "a1", html, sample_slots: {} }] }, "", "t");
    manifest.families = { latin: [], devanagari: [] };
    return renderSlide({ kitDir: dir, manifest, archetypeId: "a1", slots: { title: "Visible words" }, vars: { idx: 1, total: 1 } });
  };
  const slot = `<div data-slot="title" data-max-size="80" data-min-size="30" style="position:absolute;left:100px;top:300px;width:800px;height:120px;font-size:80px;color:var(--c-ink)">x</div>`;
  it("passes when text is visible", async () => expect((await go(slot)).problems.filter((p) => p.startsWith("INVISIBLE"))).toEqual([]));
  it("flags text hidden by a mask on its container", async () => {
    const r = await go(`<div style="mask-image:linear-gradient(#000,#000);mask-size:100% 10px;mask-repeat:no-repeat">${slot}</div>`);
    expect(r.problems.join()).toMatch(/INVISIBLE: slot "title"/);
  });
  it("flags text coloured like its background", async () => {
    const r = await go(slot.replace("var(--c-ink)", "var(--c-bg)"));
    expect(r.problems.join()).toMatch(/INVISIBLE/);
  });
});
