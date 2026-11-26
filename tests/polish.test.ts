import { describe, it, expect } from "vitest";
import { polishStamps, enforceClearance, clearStaticText } from "@/lib/ingest/polish";

const spec: any = { layout: { margins_px: { top: 90, right: 90, bottom: 90, left: 90 } } };
describe("template polish", () => {
  it("fits a stamp to its text on one line and moves the slot's offset to its box", () => {
    const h = '<div class="el-stamp"><div data-slot="stamp" style="width:120px;translate:30px 0px"></div></div>';
    const r = polishStamps(h, { stamp: "stamp_text" });
    expect(r.html).toMatch(/el-stamp"[^>]*white-space:nowrap/); expect(r.html).toContain("translate:30px 0px");
    expect(r.html).toMatch(/data-slot="stamp"[^>]*position:static/);
  });
  it("moves text clear of a vertical rule and inside the margins", () => {
    const diag: any = { slots: { headline: { rect: { x: 150, y: 300, w: 600, h: 200 } } }, furnStats: {} };
    const r = enforceClearance('<div data-slot="headline"></div>', diag, spec, [{ x: 150, thick: 2, color: "#f00", run: 1300 }], { headline: "headline" });
    expect(r.html).toMatch(/translate:\d+(\.\d+)?px 0px/); expect(r.changes[0]).toMatch(/clear of the rule/);
  });
  it("leaves text that already clears the rule alone", () => {
    const diag: any = { slots: { headline: { rect: { x: 200, y: 300, w: 600, h: 200 } } }, furnStats: {} };
    expect(enforceClearance('<div data-slot="headline"></div>', diag, spec, [{ x: 150, thick: 2, color: "#f00", run: 1300 }], { headline: "headline" }).changes).toEqual([]);
  });
  it("clears baked-in template text that sits left of the rule", () => {
    const r = clearStaticText('<div class="el-swipe">Swipe →</div>', ".el-swipe{position:absolute;left:150px;top:1200px}", spec, [{ x: 150, thick: 2, color: "#f00", run: 1300 }]);
    expect(r.html).toContain("translate:"); expect(r.changes.length).toBe(1);
  });
});

import { rulerGrid, thickenRuledLines, usesGrid, snapToRuledGrid, harmoniseFurniture } from "@/lib/ingest/polish";
describe("coherence layer", () => {
  const css1 = ".el-ruled-paper{background-image:repeating-linear-gradient(to bottom, transparent, transparent 48px, color-mix(in srgb, var(--c-g) 10%, transparent) 49px)}";
  const css2 = ".el-ruled-paper{background-image:repeating-linear-gradient(color-mix(in srgb, var(--c-g) 20%, transparent) 0 1px, transparent 1px 50px)}";
  it("thickens both rule constructions and is idempotent, keeping the pitch", () => {
    const a = thickenRuledLines(css1), b = thickenRuledLines(css2);
    expect(a.changed).toBe(1); expect(b.changed).toBe(1);
    expect(rulerGrid(a.css)).toMatchObject({ pitch: 49, thick: 2 }); expect(rulerGrid(b.css)).toMatchObject({ pitch: 50, thick: 2 });
    expect(thickenRuledLines(a.css).changed).toBe(0); expect(thickenRuledLines(b.css).changed).toBe(0);
  });
  it("puts a text baseline on a rule", () => {
    const g = rulerGrid(thickenRuledLines(css2).css)!;
    expect(usesGrid('<div class="el-ruled-paper"></div>', g)).toBe(true);
    const diag: any = { slots: { body: { size: 36, rect: { x: 100, y: 200, w: 500, h: 45 } } } };
    const r = snapToRuledGrid('<div data-slot="body"></div>', diag, { body: "body" }, g);
    const dy = Number(/translate:0px (-?\d+(?:\.\d+)?)px/.exec(r.html)?.[1] ?? 0), base = 200 + 45 * 0.78 + dy;
    expect((base + 1) % 50).toBeLessThan(1.5);
  });
  it("positions a furniture element the model left unplaced like the same element elsewhere", () => {
    const arch = [{ id: "cover", html: '<div data-furniture="Tag" style="position:absolute;left:90px;top:90px"></div>' }, { id: "closer", html: '<div data-furniture="Tag"></div>' }];
    expect(harmoniseFurniture(arch, "").length).toBe(1); expect(arch[1].html).toContain("left:90px");
  });
});

import { addEdgeBands } from "@/lib/ingest/polish";
describe("look book edge element", () => {
  const spec: any = { colors: [{ token: "paper", hex: "#F4F1E8" }, { token: "green", hex: "#0E3B2E" }], guidelines: [], elements: [{ id: "ruled-paper", description: "lines mimicking ledger paper", enabled: true, placement: "" }, { id: "receipt-edge", description: "Serrated edge", placement: "Top and/or bottom of the canvas.", enabled: true }] };
  it("adds a serrated band top and bottom on dark slides only, using the right element", () => {
    const arch = [{ id: "dark", html: '<div data-arch="dark" class="slide bg-green"><div class="el-receipt-edge"></div></div>' }, { id: "light", html: '<div data-arch="light" class="slide bg-paper"></div>' }];
    const r = addEdgeBands(arch, "", spec);
    expect(arch[0].html).toContain("el-edge-band el-edge-top"); expect(arch[0].html).toContain("el-edge-bottom"); expect(arch[1].html).not.toContain("el-edge");
    expect(r.css).toContain("clip-path:polygon"); expect(addEdgeBands(arch, r.css, spec).changes).toEqual([]); // idempotent
  });
});

import { floorTextSizes } from "@/lib/ingest/polish";
describe("type size floor and spec options", () => {
  it("raises the smallest size of running text, never touches answer options", () => {
    const r = floorTextSizes('<div data-slot="body" data-max-size="40" data-min-size="21"></div><div data-slot="option-a" data-max-size="40" data-min-size="20"></div>', { body: "body", "option-a": "body" });
    expect(r.html).toMatch(/data-slot="body"[^>]*data-min-size="26"/); expect(r.html).toMatch(/data-slot="option-a"[^>]*data-min-size="20"/);
  });
});
