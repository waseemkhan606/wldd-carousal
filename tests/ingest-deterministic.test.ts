import { describe, it, expect } from "vitest";
import { normaliseFontName } from "@/lib/ingest/fonts";
import { hexFromText } from "@/lib/ingest/colors";
import { StyleSpec } from "@/lib/ingest/spec";

describe("font normalisation (generic, no brand names)", () => {
  it.each([
    ["AAAAAA+Roboto-Regular", "Roboto", 400],
    ["BAAAAA+OpenSans-Bold", "Open Sans", 700],
    ["CAAAAA+SomeFont-9ptRegular", "Some Font", 400],
    ["XYZABC+PlayfairDisplay-BoldItalic", "Playfair Display", 700],
    ["QQQQQQ+SpaceMono-Regular", "Space Mono", 400],
    ["AAAAAA+FooBarRoman-Light", "Foo Bar", 300],
    ["AAAAAA+InterVariable", "Inter", 400],
  ])("%s", (raw, family, weight) => {
    expect(normaliseFontName(raw)).toEqual({ family, weight });
  });
});
describe("hex extraction", () => {
  it("finds, uppercases and dedupes", () => {
    const h = hexFromText(["NAME\n#aabbcc · bg #AABBCC again", "#012345"]);
    expect(h.map((x) => x.hex)).toEqual(["#AABBCC", "#012345"]);
    expect(h[1].page).toBe(2);
  });
});
describe("StyleSpec contract", () => {
  it("rejects a spec with no archetypes or bad hex", () => {
    expect(StyleSpec.safeParse({}).success).toBe(false);
  });
});

import { lintSpec } from "@/lib/ingest/lint";
import { fetchDevanagariPair } from "@/lib/ingest/fonts";
describe("spec lint", () => {
  const base: any = {
    colors: [{ token: "a" }, { token: "b" }],
    archetypes: [{ id: "cover", purpose: "cover", background_token: "a" }, { id: "end", purpose: "closer", background_token: "a" }],
    sequencing: [], rules: [],
  };
  it("flags an alternation token no archetype uses and a missing archetype id", () => {
    const w = lintSpec({ ...base, sequencing: [{ rule: "alt", machine: { type: "alternate_background", params: { tokens: ["a", "b"] } } }, { rule: "last", machine: { type: "position_archetype", params: { position: "last", archetype_id: "nope" } } }] });
    expect(w.some((x) => x.includes('"b"'))).toBe(true);
    expect(w.some((x) => x.includes("nope"))).toBe(true);
  });
  it("is quiet on a consistent spec", () => expect(lintSpec(base)).toEqual([]));
  it("accepts unicode-property regexes", () => {
    expect(lintSpec({ ...base, rules: [{ text: "x", machine: { type: "forbid", params: { pattern: "[!\\p{Emoji}]" } } }] })).toEqual([]);
  });
});
describe("devanagari pair validation (stubbed network)", () => {
  const css = (sub: string) => `/* ${sub} */\n@font-face{font-family:'X';font-weight:400;src:url(https://f/x-${sub}.woff2) format('woff2');}`;
  const stub = (map: Record<string, string[] | 400>) => (async (url: any) => {
    const u = String(url);
    if (u.includes("fonts.googleapis.com")) {
      const fam = decodeURIComponent(/family=([^:&]+)/.exec(u)![1]).replace(/\+/g, " ");
      const subs = map[fam];
      return subs === 400 || !subs ? new Response("no", { status: 400 }) : new Response(subs.map(css).join("\n"));
    }
    return new Response(new Uint8Array([1, 2, 3]));
  }) as unknown as typeof fetch;
  it("keeps a pair that ships Devanagari", async () => {
    const r = await fetchDevanagariPair("Good", [400], "/tmp/deva-t1", stub({ Good: ["latin", "devanagari"] }));
    expect(r.replaced).toBe(false);
  });
  it("replaces a Latin-only pair with the universal fallback and says so", async () => {
    const r = await fetchDevanagariPair("MonoOnly", [400], "/tmp/deva-t2", stub({ MonoOnly: ["latin"], "Noto Sans Devanagari": ["latin", "devanagari"] }));
    expect(r.replaced).toBe(true); expect(r.family).toBe("Noto Sans Devanagari"); expect(r.note).toContain("no Devanagari");
  });
});
