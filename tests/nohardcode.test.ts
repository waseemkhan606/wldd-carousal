import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Non-negotiable: no brand style lives in the product. Colours, fonts and brand names must come from the uploaded look book.
const ROOT = path.resolve(__dirname, "..");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const SRC = ["lib", "app", "components"].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => /\.(ts|tsx|md)$/.test(f));
const BRANDS = /small print|brutal dev|maison lune|archivo black|cormorant|ibm plex|space mono|volt yellow|paper white|oat cream|plum ink/i;

describe("no hard-coded brand styles", () => {
  it("has no brand names, brand fonts or brand colour names in product code or prompts", () => {
    const hits = SRC.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map((l, i) => ({ f: path.relative(ROOT, f), i: i + 1, l })).filter((x) => BRANDS.test(x.l)));
    expect(hits.map((h) => `${h.f}:${h.i} ${h.l.trim().slice(0, 80)}`)).toEqual([]);
  });
  it("prompts contain no hex colours or font families", () => {
    const hits = SRC.filter((f) => f.includes(`${path.sep}prompts${path.sep}`)).flatMap((f) => (fs.readFileSync(f, "utf8").match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((m) => `${path.basename(f)} ${m}`));
    expect(hits).toEqual([]);
  });
});
