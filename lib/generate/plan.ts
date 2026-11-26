import { z } from "zod";
import { specDigest, loadPrompt, type StyleSpec } from "../ingest/spec";
import type { KitManifest } from "../ingest/kit";
import type { CopyData, Lang, SlideCopy } from "../db/carousels";
import { llmCall } from "../llm/router";
import { modelsFor } from "../llm/router";
import { getPricing, toInr } from "../llm/pricing";
import { LANGUAGES, PLATFORMS } from "./platforms";

const Slots = z.record(z.string(), z.string());
export const SlideSchema = z.object({
  idx: z.number().int(), archetype: z.string(), slots: Slots,
  overrides: z.object({ instagram: Slots.optional(), linkedin: Slots.optional() }).optional(),
});
const Cap = z.object({ text: z.string(), hashtags: z.array(z.string()).default([]) });
export const CopySchema = z.object({ format: z.string().optional(), slides: z.array(SlideSchema).min(1), captions: z.object({ instagram: Cap, linkedin: Cap }), sources_note: z.string().optional() });
export const RepairSchema = z.object({ slides: z.array(SlideSchema).min(1), sources_note: z.string().optional(), captions: z.object({ instagram: Cap.optional(), linkedin: Cap.optional() }).optional() });

/** The look book, organised by what each part means for production. Every guideline is binding and carries its page. */
export function registerText(spec: StyleSpec, single?: Single | null): string {
  const gl = spec.guidelines.filter((g) => g.enabled && g.method !== "info" && !(single && carouselOnly(g)));
  if (!gl.length && !spec.formats.length) return "";
  const group = (title: string, cats: string[]) => { const rows = gl.filter((g) => cats.includes(g.category)); return rows.length ? `### ${title}\n${rows.map((g) => `- ${g.statement} [p.${g.page}]`).join("\n")}` : ""; };
  const carousels = spec.formats.filter((f) => f.kind === "carousel");
  return [`## Look book guidelines (every one is binding; [p.N] is the look book page)`,
    single ? `### Post format: ${single.format.name}, ${single.format.description}. This is ONE single post, not a carousel.` : carousels.length ? `### Carousel formats: choose ONE by topic and return its id as \`format\`\n${carousels.map((f) => `- ${f.id}: ${f.name}, ${f.description}${f.slides ? ` (${f.slides} slides in the look book; the requested slide count wins)` : ""}`).join("\n")}\n(Single-post formats exist but are not used for carousels: ${spec.formats.filter((f) => f.kind === "single").map((f) => f.name).join(", ") || "none"}.)` : "",
    group("Structure and content", ["structure", "content"]), group("Design (the templates already carry these; do not fight them)", ["design"]), group("Voice", ["voice"]), group("Captions", ["captions"]), group("Brand", ["brand"])].filter(Boolean).join("\n\n");
}

/** Static part first (prompt-cache friendly): instructions + compact spec digest + slot budgets. Same for every carousel of a brand. */
export async function buildSystem(spec: StyleSpec, manifest: KitManifest, promptFile = "copy.md", single?: Single | null): Promise<{ system: string; version: string }> {
  const p = await loadPrompt(promptFile);
  const budgets = manifest.archetypes.map((a) => `${a.id}: ${a.slots.map((s) => `${s.name}(${s.kind}) ≤${s.max_words}w/${s.max_chars}c${s.optional ? " optional" : ""}`).join("; ")}`).join("\n");
  const handle = spec.brand.handle ? `Instagram handle: ${spec.brand.handle}. LinkedIn handle: ${spec.brand.linkedin_handle ?? spec.brand.handle}.` : "";
  return { system: `${p.body}\n\n## Brand digest\n${specDigest(spec)}\n\n${registerText(spec, single)}\n\n## Slot budgets per archetype\n${budgets}\n\n${handle}`, version: p.version };
}

/**
 * Archetype per slide when the rules + kit determine it (first/last position rules, background rotation over the
 * "family" of body archetypes that shares the cover's id prefix). null = the model chooses. Pure code.
 */
export function planSequence(spec: StyleSpec, manifest: KitManifest, n: number, forced?: string): (string | null)[] {
  if (forced && n === 1) return [forced];
  const seq: (string | null)[] = Array(n).fill(null);
  const rules = [...spec.sequencing, ...spec.rules.filter((x) => x.enabled)].map((r) => r.machine).filter(Boolean) as { type: string; params: any }[];
  // The anatomy knows which templates are the carousel's cover and its inside slides (by the look book page they come from).
  const cover = spec.lookbook?.coverPage, inside = spec.lookbook?.insidePage;
  const byPage = (pg?: number) => (pg ? spec.archetypes.filter((a) => a.source_page === pg).map((a) => a.id) : []);
  const isCloser = (a: { id: string; purpose: string }) => /clos|outro|last|end/i.test(`${a.id} ${a.purpose}`);
  const first = (rules.find((r) => r.type === "position_archetype" && r.params.position === "first")?.params.archetype_id as string | undefined) ?? byPage(cover)[0];
  const last = (rules.find((r) => r.type === "position_archetype" && r.params.position === "last")?.params.archetype_id as string | undefined) ?? spec.archetypes.find(isCloser)?.id;
  if (first) seq[0] = first;
  if (last) seq[n - 1] = last;
  const alt = rules.find((r) => r.type === "alternate_background")?.params.tokens as string[] | undefined;
  if (alt?.length) {
    const insideIds = new Set(byPage(inside));
    const prefix = (first ?? "").split("-").length > 1 ? (first ?? "").split("-")[0] + "-" : "";
    // preferred pool: the templates drawn on the look book's "inside the carousel" page; fall back to the id-prefix family
    let pool = manifest.archetypes.filter((a) => a.id !== first && a.id !== last && insideIds.has(a.id));
    if (!pool.length) pool = manifest.archetypes.filter((a) => a.id !== first && a.id !== last && (!prefix || a.id.startsWith(prefix)));
    if (!pool.length) pool = manifest.archetypes.filter((a) => a.id !== first && a.id !== last);
    const forToken = (t: string) => pool.find((a) => a.background_token === t)?.id ?? null;
    const body = seq.map((_, i) => i).filter((i) => seq[i] === null);
    let best = 0, bestHits = -1;
    for (let off = 0; off < alt.length; off++) { const hits = body.filter((_, k) => forToken(alt[(off + k) % alt.length])).length; if (hits > bestHits) { bestHits = hits; best = off; } }
    body.forEach((i, k) => { seq[i] = forToken(alt[(best + k) % alt.length]); });
  }
  return seq;
}

/** Requirements derived from machine-form rules, stated in plain words in the (variable) request. */
export function requirementsText(spec: StyleSpec, n: number, manifest?: KitManifest, single?: Single | null): string {
  if (single) return singleRequirements(single, manifest, wordCap(spec));
  const out: string[] = [];
  if (manifest) { const seq = planSequence(spec, manifest, n); if (seq.every(Boolean)) out.push(`Use exactly this archetype for each slide: ${seq.map((a, i) => `${i + 1}=${a}`).join(", ")}.`); else if (seq.some(Boolean)) out.push(`Fixed archetypes: ${seq.map((a, i) => (a ? `slide ${i + 1}=${a}` : null)).filter(Boolean).join(", ")}; choose the others.`); }
  for (const r of [...spec.sequencing, ...spec.rules.filter((x) => x.enabled)]) {
    const m = r.machine, prm = (m?.params ?? {}) as any;
    if (m?.type === "position_archetype") out.push(`Slide ${prm.position === "first" ? 1 : n} must use archetype "${prm.archetype_id}".`);
    if (m?.type === "alternate_background") out.push(`Between the first and last slides, backgrounds must rotate in this order: ${(prm.tokens ?? []).join(" → ")} (choose archetypes by their background accordingly).`);
  }
  return out.join("\n") || "None beyond the brand rules.";
}

export function userMessage(topic: string, n: number, lang: Lang, spec: StyleSpec, manifest?: KitManifest, formatId?: string): string {
  const single = singleOf(spec, formatId);
  if (single) return `Topic: ${topic}\nThis is a SINGLE POST (1 slide), format: ${single.format.id} (${single.format.name}: ${single.format.description}). Return format = "${single.format.id}" and exactly one slide using archetype "${single.archetype}".\nLanguage: ${LANGUAGES[lang]}\nRequirements:\n${singleRequirements(single, manifest, wordCap(spec))}`;
  const f = formatId ? spec.formats.find((x) => x.id === formatId) : undefined;
  return `Topic: ${topic}\nNumber of slides N: ${n}\nLanguage: ${LANGUAGES[lang]}${f ? `\nUse this carousel format: ${f.id} (${f.name}: ${f.description})` : ""}\nRequirements:\n${requirementsText(spec, n, manifest)}`;
}

export async function generateCopy(opts: { spec: StyleSpec; manifest: KitManifest; topic: string; n: number; lang: Lang; carouselId: number; format?: string }) {
  const single = singleOf(opts.spec, opts.format), { system } = await buildSystem(opts.spec, opts.manifest, "copy.md", single);
  return llmCall({
    stage: "carousel.copy", tier: "text_strong", system, user: userMessage(opts.topic, opts.n, opts.lang, opts.spec, opts.manifest, opts.format),
    schema: CopySchema, carouselId: opts.carouselId, maxOutTokens: 8000, thinking: 2500,
  });
}

/**
 * Cost before generating = copy call + cover director + cover judge (+ an allowance for one repair), from token counts
 * (chars/3.6 + overhead) and the live price of the configured models. Deliberately a slight over-estimate.
 */
export async function estimateCost(spec: StyleSpec, manifest: KitManifest, topic: string, n: number, lang: Lang, formatId?: string) {
  const single = singleOf(spec, formatId); if (single) n = 1;
  const { system } = await buildSystem(spec, manifest, "copy.md", single);
  const inTok = Math.ceil((system.length + userMessage(topic || "x".repeat(40), n, lang, spec, manifest).length) / 3.6) + 200;
  const slideOut = n * (lang === "hi" ? 190 : 130) + 450;
  const price = (tier: "text_strong" | "vision_cheap") => { const m = modelsFor(tier); return getPricing()[m.gemini] ?? { in: 1.25, out: 10 }; };
  const strong = price("text_strong"), judge = price("vision_cheap");
  const copy = (inTok * strong.in + (slideOut + 2500) * strong.out) / 1e6;
  const cover = single ? 0 : ((inTok + n * 60) * strong.in + (4 * 120 + 1500) * strong.out) / 1e6; // the cover director only runs on carousels
  const pick = single ? 0 : (3000 * judge.in + 800 * judge.out) / 1e6;
  const repair = 0.8 * ((inTok * 0.6) * strong.in + 2000 * strong.out) / 1e6; // measured: one repair fired on every e2e carousel, so budget for it
  const usd = copy + cover + pick + repair;
  return { inTokens: inTok, outTokens: slideOut + 2500, usd, inr: toInr(usd), model: modelsFor("text_strong").openrouter, parts: { copy: toInr(copy), cover: toInr(cover + pick), repair_allowance: toInr(repair) } };
}

export const slideSchemaText = (manifest: KitManifest, archetype: string) => manifest.archetypes.find((a) => a.id === archetype)?.slots.map((s) => `${s.name}(${s.kind}) ≤${s.max_words} words / ≤${s.max_chars} chars${s.optional ? " optional" : ""}`).join("; ") ?? "";
export type { SlideCopy, CopyData };

/**
 * The slide plan is a rule of the look book, not a suggestion to the model: wherever code can decide the template of a
 * slide, it does. The model's text is kept when the two templates take the same slots (e.g. the white and black variants
 * of the same inside slide); otherwise the slide is left for the validator to flag and the repair call to rewrite.
 */
export function applyPlan<T extends { idx: number; archetype: string }>(slides: T[], spec: StyleSpec, manifest: KitManifest): number {
  const seq = planSequence(spec, manifest, slides.length), names = (id: string) => (manifest.archetypes.find((a) => a.id === id)?.slots.map((x) => x.name).sort().join("|") ?? "");
  let changed = 0;
  [...slides].sort((a, b) => a.idx - b.idx).forEach((sl, i) => { const want = seq[i]; if (want && sl.archetype !== want && names(want) === names(sl.archetype)) { sl.archetype = want; changed++; } });
  return changed;
}

/** Slide counters are facts, not copy: whatever the model wrote ("3/5" on slide 2), the number is set in code. */
export function fixCounters(slides: { idx: number; archetype: string; slots: Record<string, string>; overrides?: Record<string, Record<string, string>> }[], manifest: KitManifest): number {
  const n = slides.length; let fixed = 0;
  const fix = (v: string, idx: number) => { const m = /(\d+)(\s*(?:\/|of|OF|Of|\|)\s*)(\d+)/.exec(v); return m ? v.replace(m[0], `${idx}${m[2]}${n}`) : `${idx}/${n}`; };
  for (const s of slides) {
    const a = manifest.archetypes.find((x) => x.id === s.archetype); if (!a) continue;
    for (const sl of a.slots) if (sl.kind === "counter" || /(^|[-_])(slide[-_]?)?(count|counter|number)$/i.test(sl.name) && /count/i.test(sl.name)) {
      for (const bag of [s.slots, ...Object.values(s.overrides ?? {})]) if (bag[sl.name] !== undefined) { const nv = fix(bag[sl.name], s.idx); if (nv !== bag[sl.name]) { bag[sl.name] = nv; fixed++; } }
    }
  }
  return fixed;
}


// ---- single posts (the look book's one-slide formats, e.g. a quiz) ----
export type Single = { format: StyleSpec["formats"][number]; archetype: string };
/** The one-slide format and the template drawn on the look book page it comes from. */
export function singleOf(spec: StyleSpec, formatId?: string | null): Single | null {
  const f = formatId ? (spec.formats ?? []).find((x) => x.id === formatId && x.kind === "single") : undefined; if (!f) return null;
  const a = spec.archetypes.find((x) => f.page && x.source_page === f.page); return a ? { format: f, archetype: a.id } : null;
}
/** Guidelines that only make sense across a carousel's slides (roles by position, rotation, "show the maths", slide counter). */
export function carouselOnly(g: StyleSpec["guidelines"][number]): boolean {
  const t = g.check?.type ?? "";
  return ["slide_role", "alternate_background", "position_archetype", "show_the_maths"].includes(t) || (t === "furniture_present" && /count/i.test(JSON.stringify(g.check?.params ?? {}) + g.statement));
}
function singleRequirements(single: Single, manifest?: KitManifest, cap?: number): string {
  const a = manifest?.archetypes.find((x) => x.id === single.archetype);
  const opts = a?.slots.filter((s) => /option|choice|answer/i.test(s.name)) ?? [];
  return [
    `One slide only, archetype "${single.archetype}". Fill every slot that is not optional. No cover, no closing slide, no "swipe", no slide counter.`,
    opts.length >= 3
      ? `This is a quiz. The headline/question must create curiosity: a concrete, specific question the reader wants to answer. Write exactly ${opts.length} answer options (${opts.map((s) => s.name).join(", ")}): one correct, the others plausible and close enough to tempt. NEVER reveal which is correct on the slide or in the caption; the caption invites the answer in the comments and says the answer comes next day: it must not state, hint at or work out the answer, and must not show the result of the calculation.${cap ? ` Total words on the slide (question + every option + any other text) must be at most ${cap}: keep the question under ${Math.max(6, cap - opts.length * 4 - 4)} words and every option at most 4 words.` : ""}`
      : `Make the post stand on its own: one clear idea, in the brand's voice.`,
    `Captions: for both platforms, written for a single post (no "swipe", no "slide 3").`,
  ].join("\n");
}

const wordCap = (spec: StyleSpec): number | undefined => { const v = [...spec.sequencing, ...spec.rules.filter((r) => r.enabled)].map((r) => r.machine).filter((m): m is { type: string; params: any } => !!m && m.type === "max_words_per_slide").map((m) => Number(m.params.max)).filter(Boolean); return v.length ? Math.min(...v) : undefined; };
