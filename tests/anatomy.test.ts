import { describe, it, expect } from "vitest";
import path from "node:path";
import { analyseLookbook, atomise, rejoin } from "@/lib/ingest/anatomy";

const fx = (n: string) => path.resolve("fixtures", `${n} - sample look book.pdf`);

describe("atomise: rule bullets become atomic, individually checkable statements", () => {
  it("splits on the middle dot and carries 'Slides' onto ranges", () => {
    expect(atomise("▸ Slide 1: the hook question + a stamp · 2–4: one number or idea each")).toEqual(["Slide 1: the hook question + a stamp", "Slides 2–4: one number or idea each"]);
  });
  it("splits furniture lists and carries 'on every slide' to each", () => {
    expect(atomise("▸ Tag top-left, slide count top-right, logo bottom-right on every slide")).toEqual(["Tag top-left on every slide", "Slide count top-right on every slide", "Logo bottom-right on every slide"]);
  });
  it("splits 'no x, no y' but keeps comma phrases that are one rule", () => {
    expect(atomise("▸ Max 30 words a slide · one stamp per slide, max · no stock photos, no faces")).toEqual(["Max 30 words a slide", "One stamp per slide, max", "No stock photos", "No faces"]);
  });
});

describe("rejoin: tracked (letter-spaced) text is rebuilt from letter gaps", () => {
  const word = (t: string, x: number) => ({ x0: x, x1: x + 6, t });
  it("restores word spaces when every letter is its own word", () => {
    const letters = "HOW TO GO", ws = []; let x = 0;
    for (const c of letters) { if (c === " ") { x += 6; continue; } ws.push(word(c, x)); x += 9; }
    expect(rejoin(ws)).toBe("HOW TO GO");
  });
  it("leaves normal text alone and merges kerning-width splits", () => {
    expect(rejoin([{ x0: 0, x1: 20, t: "Plain" }, { x0: 26, x1: 50, t: "words" }])).toBe("Plain words");
    expect(rejoin([{ x0: 0, x1: 30, t: "BOT" }, { x0: 31.4, x1: 50, t: "TOM" }])).toBe("BOTTOM");
  });
});

// Three look books in three very different styles but one document anatomy: the parser must read all of them.
const cases = [
  { file: "Small Print", cadence: /2 posts a day/i, pillars: ["The Number", "Quick Maths", "The Breakdown", "The Trap"], hex: ["#0E3B2E", "#F2B33D", "#D7442E", "#F4F1E8"], rot: -4, types: ["ARCHIVO BLACK", "DM SANS", "ANONYMOUS PRO"] },
  { file: "Brutal Dev", cadence: /2 posts a day/i, pillars: ["The Command", "Quick Fix", "The Teardown", "The Gotcha"], hex: ["#0A0A0A", "#FFE600", "#FF2D2D", "#FAFAFA"], rot: 3, types: ["ARCHIVO BLACK", "IBM PLEX MONO", "SPACE MONO"] },
  { file: "Maison Lune", cadence: /1 post a day/i, pillars: ["The Ritual", "Skin Quiz", "The Routine", "The Myth"], hex: ["#F6DDE0", "#FBF6EE", "#5B3A4A", "#C9A98B"], rot: 6, types: ["CORMORANT GARAMOND", "JOST", "JOST"] },
];

describe.each(cases)("anatomy of $file", (c) => {
  it("finds every section, with full block coverage and no warnings", async () => {
    const a = await analyseLookbook(fx(c.file));
    expect(a.pages.map((p) => p.kind)).toEqual(["profile", "brand_system", "post", "post", "carousel_cover", "carousel_inside", "logo"]);
    expect(a.warnings).toEqual([]);
    expect(a.unmapped).toEqual([]);
    expect(a.coverage.mapped).toBe(a.coverage.blocks);
  });
  it("reads colours, elements, type and pillars exactly", async () => {
    const a = await analyseLookbook(fx(c.file));
    expect(a.colours.map((x) => x.hex)).toEqual(c.hex);
    expect(a.colours.every((x) => x.roles.length >= 1)).toBe(true);
    expect(a.elements).toHaveLength(4);
    expect(a.elements.find((e) => /stamp/i.test(e.name))?.rotation).toBe(c.rot);
    expect(a.elements.some((e) => /logo/i.test(e.name) && /bottom-right/i.test(e.placement ?? ""))).toBe(true);
    expect(a.type.map((t) => t.family)).toEqual(c.types);
    expect(a.type.every((t) => t.roles.length >= 1)).toBe(true);
    expect(a.pillars.map((p) => p.name)).toEqual(c.pillars);
    expect(a.pillars.map((p) => p.kind)).toEqual(["single", "single", "carousel", "carousel"]);
    expect(a.cadence).toMatch(c.cadence);
  });
  it("reads the slide plan, rules, voice and logo rule", async () => {
    const a = await analyseLookbook(fx(c.file));
    expect(a.carousel?.slides).toBe(5);
    expect(a.carousel?.motto).toMatch(/one idea each/i);
    expect(a.posts).toHaveLength(2);
    expect(a.posts.every((p) => p.width === 1080 && p.height === 1350)).toBe(true);
    expect(a.rules.flatMap((r) => r.atoms)).toHaveLength(13);
    expect(a.rules.flatMap((r) => r.atoms).some((s) => /^Slide 1:.*hook question/i.test(s))).toBe(true);
    expect(a.rules.flatMap((r) => r.atoms).some((s) => /^Max \d+ words a slide/i.test(s))).toBe(true);
    expect(a.voice?.sentences.length).toBeGreaterThanOrEqual(3);
    expect(a.voice?.text).toMatch(/always/i);
    expect(a.logo?.usage).toMatch(/only/i);
    expect(a.profile?.feedRules).toHaveLength(3);
    expect(a.profile?.highlights.length).toBe(5);
  });
});
