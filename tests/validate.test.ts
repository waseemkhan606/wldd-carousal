import { describe, it, expect } from "vitest";
import { validateCopy, scriptIssue, words, plain } from "@/lib/generate/validate";
import { planSequence } from "@/lib/generate/plan";

const spec: any = {
  rules: [
    { text: "Max 12 words per slide", enabled: true, machine: { type: "max_words_per_slide", params: { max: 12 } } },
    { text: "One stamp max", enabled: true, machine: { type: "max_elements_per_slide", params: { element_kind: "stamp", max: 1 } } },
    { text: "No emojis", enabled: true, machine: { type: "forbid", params: { pattern: "emoji" } } },
    { text: "No miracle", enabled: true, machine: { type: "forbid", params: { pattern: "(miracle|guaranteed)" } } },
  ],
  sequencing: [
    { rule: "cover first", machine: { type: "position_archetype", params: { position: "first", archetype_id: "cover" } } },
    { rule: "closer last", machine: { type: "position_archetype", params: { position: "last", archetype_id: "closer" } } },
    { rule: "rotate", machine: { type: "alternate_background", params: { tokens: ["a", "b"] } } },
  ],
};
const sl = (name: string, kind = "body", mw = 6, mc = 40, optional = false) => ({ name, kind, optional, max_words: mw, max_chars: mc });
const manifest: any = { archetypes: [
  { id: "cover", background_token: "a", slots: [sl("headline", "headline"), sl("stamp", "stamp_text", 2, 12, true)] },
  { id: "body-a", background_token: "a", slots: [sl("headline", "headline"), sl("body")] },
  { id: "body-b", background_token: "b", slots: [sl("headline", "headline"), sl("body")] },
  { id: "closer", background_token: "b", slots: [sl("headline", "headline"), sl("cta", "cta", 3, 20)] },
] };
const cap = { instagram: { text: "t", hashtags: ["#a"] }, linkedin: { text: "t", hashtags: ["#a"] } };
const good: any = { slides: [
  { idx: 1, archetype: "cover", slots: { headline: "Start here" } },
  { idx: 2, archetype: "body-a", slots: { headline: "One", body: "Short body" } },
  { idx: 3, archetype: "body-b", slots: { headline: "Two", body: "Short body" } },
  { idx: 4, archetype: "closer", slots: { headline: "Done", cta: "Save this" } },
], captions: cap };
const run = (copy: any, lang: any = "en", n = 4) => validateCopy(copy, spec, manifest, lang, n);
const clone = () => JSON.parse(JSON.stringify(good));

describe("validateCopy", () => {
  it("accepts a clean carousel", () => expect(run(good)).toEqual([]));
  it("enforces per-slot words and chars", () => {
    const c = clone(); c.slides[1].slots.body = "one two three four five six seven eight";
    expect(run(c).map((i) => i.msg).join()).toMatch(/slot "body" has 8 words, limit 6/);
  });
  it("enforces required slots and unknown slots", () => {
    const c = clone(); c.slides[1].slots.body = ""; c.slides[2].slots.bogus = "x";
    const m = run(c).map((i) => i.msg).join(); expect(m).toMatch(/"body" is required/); expect(m).toMatch(/"bogus" does not exist/);
  });
  it("enforces the per-slide word rule across slots", () => {
    const c = clone(); c.slides[1].slots = { headline: "a b c d e f", body: "g h i j k l" }; // 12 ok
    expect(run(c).filter((i) => /rule allows/.test(i.msg))).toEqual([]);
    c.slides[1].slots.body = "g h i j k l m"; // slot limit 6 -> also overall 13
    expect(run(c).some((i) => /slide has 13 words, rule allows 12/.test(i.msg))).toBe(true);
  });
  it("limits stamp elements", () => {
    const c = clone(); c.slides[0].slots.stamp = "READ THIS"; expect(run(c).filter((i) => /stamp/.test(i.msg))).toEqual([]);
  });
  it("forbids emojis and banned words", () => {
    const c = clone(); c.slides[1].slots.body = "A miracle 😀"; const m = run(c).map((i) => i.msg).join();
    expect(m).toMatch(/breaks a rule/);
  });
  it("checks first/last archetype and background rotation", () => {
    const c = clone(); c.slides[0].archetype = "body-a"; c.slides[0].slots = { headline: "x", body: "y" };
    expect(run(c).map((i) => i.msg).join()).toMatch(/first slide must use archetype "cover"/);
    const d = clone(); d.slides[2] = { idx: 3, archetype: "body-a", slots: { headline: "Two", body: "b" } };
    expect(run(d).map((i) => i.msg).join()).toMatch(/rotate/);
  });
  it("reports wrong slide count and platform-specific caption limits", () => {
    expect(run(good, "en", 5).map((i) => i.msg).join()).toMatch(/expected 5 slides/);
    const c = clone(); c.captions.linkedin.hashtags = ["#1", "#2", "#3", "#4", "#5", "#6"];
    expect(run(c).some((i) => i.platform === "linkedin" && /hashtags/.test(i.msg))).toBe(true);
  });
  it("validates platform overrides against the same limits and tags the platform", () => {
    const c = clone(); c.slides[3].overrides = { linkedin: { cta: "Follow us and comment below please" } };
    const bad = run(c).filter((i) => /"cta"/.test(i.msg)); expect(bad.length).toBeGreaterThan(0); expect(bad.every((i) => i.platform === "linkedin")).toBe(true);
  });
});

describe("script rules", () => {
  it("English/Hinglish may not contain Devanagari", () => { expect(scriptIssue("नमस्ते friends", "en")).toMatch(/Devanagari/); expect(scriptIssue("Aapka paisa safe hai", "hinglish")).toBeNull(); expect(scriptIssue("पैसा", "hinglish")).toBeTruthy(); });
  it("Hindi must be mostly Devanagari, but numbers/currency/short tokens pass", () => {
    expect(scriptIssue("सैलरी का ₹10,000 बचाएं", "hi")).toBeNull();
    expect(scriptIssue("Save your salary today", "hi")).toMatch(/Devanagari/);
    expect(scriptIssue("₹36,500", "hi")).toBeNull();
    expect(scriptIssue("SIP", "hi")).toBeNull();
    expect(scriptIssue("हर महीने SIP और EMI का हिसाब रखें", "hi")).toBeNull();
    expect(scriptIssue("SAVE THIS", "hi")).toMatch(/Devanagari/);
  });
  it("conjuncts are counted as Devanagari letters", () => expect(scriptIssue("क्षमा त्रुटि श्रम", "hi")).toBeNull());
});
describe("text helpers", () => { it("emphasis markers don't count as words or chars", () => { expect(words("*one* two")).toHaveLength(2); expect(plain("a *b* c")).toBe("a b c"); expect(plain("2 * 3 * 4")).toBe("2 * 3 * 4"); }); });

describe("planSequence", () => {
  it("fixes first/last and rotates body archetypes by background", () => {
    expect(planSequence(spec, manifest, 6)).toEqual(["cover", "body-a", "body-b", "body-a", "body-b", "closer"]);
  });
  it("leaves undeterminable positions to the model", () => {
    const m2: any = { archetypes: manifest.archetypes.filter((a: any) => a.id !== "body-b") };
    expect(planSequence(spec, m2, 5).filter((x) => x === null).length).toBeGreaterThan(0);
  });
});

describe("look book slide roles and caption sources (from the register)", () => {
  const G = (statement: string, check: any) => ({ id: statement, section: "Carousel rules", page: 6, quote: statement, statement, category: "structure", scope: "slide", method: "code", check, enabled: true });
  const specG: any = { ...spec, guidelines: [
    G("Slide 1: the hook question + a stamp", { type: "slide_role", params: { position: "first", requires: [{ kind: "question" }, { kind: "stamp" }] } }),
    G("Slide 5: the fix + \"Save this\" stamp", { type: "slide_role", params: { position: "last", requires: [{ kind: "stamp" }, { kind: "phrase", text: "Save this" }] } }),
    G("Sources in the caption", { type: "caption_sources", params: {} }),
  ] };
  const m2: any = { archetypes: [
    { id: "cover", background_token: "a", slots: [sl("headline", "headline"), sl("stamp", "stamp_text", 2, 12, true)] },
    { id: "body-a", background_token: "a", slots: [sl("headline", "headline"), sl("body")] },
    { id: "body-b", background_token: "b", slots: [sl("headline", "headline"), sl("body")] },
    { id: "closer", background_token: "b", slots: [sl("headline", "headline"), sl("stamp", "stamp_text", 3, 20, true)] },
  ] };
  const ok = (): any => ({ slides: [
    { idx: 1, archetype: "cover", slots: { headline: "Is it really free?", stamp: "READ THIS" } },
    { idx: 2, archetype: "body-a", slots: { headline: "One", body: "Short body" } },
    { idx: 3, archetype: "body-b", slots: { headline: "Two", body: "Short body" } },
    { idx: 4, archetype: "closer", slots: { headline: "Done", stamp: "Save this" } },
  ], captions: cap, sources_note: "Illustrative figures." });
  const v = (c: any, lang: any = "en") => validateCopy(c, specG, m2, lang, 4).map((i) => i.msg).join(" | ");
  it("accepts a carousel that follows the roles", () => expect(validateCopy(ok(), specG, m2, "en", 4).filter((i) => /look book/.test(i.msg))).toEqual([]));
  it("flags a cover that isn't a question, or has no stamp", () => {
    const c = ok(); c.slides[0].slots.headline = "It is free"; expect(v(c)).toMatch(/hook question/);
    const d = ok(); d.slides[0].slots.stamp = ""; expect(v(d)).toMatch(/stamp/);
  });
  it("flags a closer whose stamp lacks the required wording, but only in English", () => {
    const c = ok(); c.slides[3].slots.stamp = "BYE"; expect(v(c)).toMatch(/must read “Save this”/);
    expect(v(c, "hinglish")).not.toMatch(/must read/);
  });
  it("requires the working to be shown when figures appear (show the maths)", () => {
    const G2: any = { ...specG, guidelines: [...specG.guidelines, G("Always show the maths", { type: "show_the_maths", params: {} })] };
    const withFig = ok(); withFig.slides[1].slots.body = "Save ₹5,000 a month";
    const msg = (c: any) => validateCopy(c, G2, m2, "en", 4).map((i) => i.msg).join(" | ");
    expect(msg(withFig)).toMatch(/no calculation is written out/);
    withFig.slides[2].slots.body = "₹5,000 × 12 = ₹60,000"; expect(msg(withFig)).not.toMatch(/no calculation/);
    expect(msg(ok())).not.toMatch(/no calculation/); // no figures: nothing to show
  });
  it("requires sources for the captions", () => { const c = ok(); delete c.sources_note; expect(v(c)).toMatch(/sources_note/); });
  it("flags a template that has no stamp slot where one is required", () => {
    const c = ok(); c.slides[3].archetype = "body-b"; c.slides[3].slots = { headline: "Done", body: "x" }; expect(v(c)).toMatch(/no stamp slot/);
  });
});

describe("planSequence uses the look book's inside-slide templates when the anatomy knows them", () => {
  it("does not borrow a single-post template for the rotation", () => {
    const sp: any = {
      rules: [], sequencing: [{ rule: "alt", machine: { type: "alternate_background", params: { tokens: ["white", "black"] } } }],
      lookbook: { coverPage: 5, insidePage: 6 },
      archetypes: [{ id: "command", purpose: "single post", background_token: "white", source_page: 3 }, { id: "cover", purpose: "cover", background_token: "white", source_page: 5 },
        { id: "inside-white", purpose: "body", background_token: "white", source_page: 6 }, { id: "inside-black", purpose: "body", background_token: "black", source_page: 6 }, { id: "closer", purpose: "closer", background_token: "black" }],
    };
    const mf: any = { archetypes: sp.archetypes.map((a: any) => ({ id: a.id, background_token: a.background_token, slots: [] })) };
    expect(planSequence(sp, mf, 5)).toEqual(["cover", "inside-white", "inside-black", "inside-white", "closer"]);
  });
});

import { z } from "zod";
import { StyleSpec } from "@/lib/ingest/spec";
import { CopySchema } from "@/lib/generate/plan";
describe("zod contracts reject malformed model output", () => {
  it("StyleSpec rejects a spec with no colours", () => { expect(StyleSpec.safeParse({}).success).toBe(false); });
  it("copy schema rejects slides without slots", () => { expect(CopySchema.safeParse({ slides: [{ idx: 1, archetype: "x" }] }).success).toBe(false); });
});

import { capSlideWords } from "@/lib/generate/validate";
describe("hard word cap in code", () => {
  it("cuts the longest body back to a complete sentence", () => {
    const sp: any = { sequencing: [], rules: [{ enabled: true, machine: { type: "max_words_per_slide", params: { max: 12 } } }] };
    const mf: any = { archetypes: [{ id: "a", slots: [{ name: "headline", kind: "headline" }, { name: "body", kind: "body" }] }] };
    const copy: any = { slides: [{ idx: 1, archetype: "a", slots: { headline: "Pay in full", body: "Always pay the bill in full. It avoids interest charges. It builds a good history." } }] };
    expect(capSlideWords(copy, sp, mf)).toEqual([1]);
    const total = Object.values(copy.slides[0].slots).join(" ").split(/\s+/).length;
    expect(total).toBeLessThanOrEqual(12); expect(copy.slides[0].slots.body).toMatch(/[.!?]$/);
  });
});

import { fixCounters } from "@/lib/generate/plan";
describe("slide counters are set in code", () => {
  it("corrects a wrong counter and keeps the model's style", () => {
    const mf: any = { archetypes: [{ id: "a", slots: [{ name: "slide-count", kind: "counter" }, { name: "headline", kind: "headline" }] }] };
    const sl: any = [{ idx: 2, archetype: "a", slots: { "slide-count": "3/5", headline: "x" } }, { idx: 3, archetype: "a", slots: { "slide-count": "3 of 5" } }, { idx: 4, archetype: "a", slots: { "slide-count": "4 OF 4" } }];
    expect(fixCounters(sl, mf)).toBe(3);
    expect(sl[0].slots["slide-count"]).toBe("2/3"); expect(sl[1].slots["slide-count"]).toBe("3 of 3");
  });
});
