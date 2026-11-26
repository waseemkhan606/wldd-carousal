// Deterministic checks on generated copy. Pure code: no LLM. Everything here is a hard rule from the spec or the brief.
import type { StyleSpec } from "../ingest/spec";
import type { KitManifest } from "../ingest/kit";
import type { CopyData, Lang, SlideCopy } from "../db/carousels";
import { carouselOnly } from "./plan";
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from "./platforms";

export type Issue = { idx: number; platform: PlatformId | "both"; slot?: string; msg: string };

export const plain = (t: string) => t.replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1");
export const words = (t: string) => plain(t).trim().split(/\s+/).filter(Boolean);
const DEVA = /[ऀ-ॿ]/, LETTER = /\p{L}/u;

export function slotsFor(s: SlideCopy, platform: PlatformId): Record<string, string> {
  return { ...s.slots, ...(s.overrides?.[platform] ?? {}) };
}

/** Script rules: English/Hinglish never contain Devanagari; Hindi slots with real words are mostly Devanagari. */
// Latin acronyms that are normal inside Hindi text (a language fact, not a brand rule).
const ACRONYMS = /\b(SIP|EMI|UPI|PPF|NPS|ELSS|FD|RD|GST|ITR|TDS|KYC|ATM|PIN|OTP|APR|CIBIL|IRR|CAGR|NAV|AMC|ETF|IPO|EPF|PF|HRA|LTCG|STCG|RBI|SEBI|NSE|BSE|GDP|AI|SMS|QR|PAN|ID|CC|KB|MB|GB|TV|AC|EV|UK|US|USA|IT|HR|CEO)\b/g;
export function scriptIssue(text: string, lang: Lang): string | null {
  const t = lang === "hi" ? plain(text).replace(ACRONYMS, "") : plain(text), letters = [...t].filter((c) => LETTER.test(c));
  if (lang !== "hi") return DEVA.test(t) ? `contains Devanagari, but this carousel is ${lang === "en" ? "English" : "Hinglish (Roman script only)"}` : null;
  if (letters.length < 3) return null; // numbers / currency / symbols only
  const share = letters.filter((c) => DEVA.test(c)).length / letters.length;
  return share < 0.6 ? `should be written in Devanagari (only ${Math.round(share * 100)}% of its letters are)` : null;
}

function compile(pattern: string): RegExp | null {
  if (/^emojis?$/i.test(pattern.trim())) return /\p{Extended_Pictographic}/u;
  try { return new RegExp(pattern, "iu"); } catch { try { return new RegExp(pattern, "i"); } catch { return null; } }
}

export function validateCopy(copy: CopyData, spec: StyleSpec, manifest: KitManifest, lang: Lang, n: number): Issue[] {
  const issues: Issue[] = [];
  const add = (idx: number, platform: Issue["platform"], msg: string, slot?: string) => issues.push({ idx, platform, slot, msg });
  const arch = new Map(manifest.archetypes.map((a) => [a.id, a]));
  const bgOf = (id: string) => arch.get(id)?.background_token;
  const rules = [...spec.rules.filter((r) => r.enabled), ...spec.sequencing].map((r) => ({ text: "text" in r ? r.text : r.rule, machine: r.machine }));

  if (copy.slides.length !== n) add(0, "both", `expected ${n} slides, got ${copy.slides.length}`);
  copy.slides.forEach((s, i) => { if (s.idx !== i + 1) add(s.idx, "both", `slide numbers must run 1..${n} in order`); });

  for (const s of copy.slides) {
    const a = arch.get(s.archetype);
    if (!a) { add(s.idx, "both", `unknown archetype "${s.archetype}"`); continue; }
    for (const p of PLATFORM_IDS) {
      const slots = slotsFor(s, p), tag = (s.overrides?.[p] ? p : "both") as Issue["platform"];
      for (const k of Object.keys(slots)) if (!a.slots.some((x) => x.name === k)) add(s.idx, tag, `slot "${k}" does not exist in archetype "${a.id}"`, k);
      let total = 0;
      for (const sl of a.slots) {
        const v = slots[sl.name] ?? "";
        const w = words(v).length, c = [...plain(v)].length;
        total += w;
        const from = (s.overrides?.[p] && sl.name in (s.overrides[p] ?? {})) ? p : "both";
        if (!sl.optional && !v.trim()) add(s.idx, from, `slot "${sl.name}" is required but empty`, sl.name);
        if (w > sl.max_words) add(s.idx, from, `slot "${sl.name}" has ${w} words, limit ${sl.max_words}`, sl.name);
        if (c > sl.max_chars) add(s.idx, from, `slot "${sl.name}" has ${c} characters, limit ${sl.max_chars}`, sl.name);
        const sc = v.trim() ? scriptIssue(v, lang) : null;
        if (sc) add(s.idx, from, `slot "${sl.name}" ${sc}`, sl.name);
        if ((v.match(/\*/g) ?? []).length % 2) add(s.idx, from, `slot "${sl.name}" has an unpaired * (emphasis markers must come in pairs)`, sl.name);
      }
      for (const r of rules) {
        const m = r.machine; if (!m) continue; const prm = m.params as any;
        if (m.type === "max_words_per_slide" && total > prm.max) add(s.idx, tag, `slide has ${total} words, rule allows ${prm.max}: "${r.text}"`);
        if (m.type === "max_elements_per_slide") {
          const kind = String(prm.element_kind ?? "");
          const slotKind = /stamp/i.test(kind) ? "stamp_text" : kind;
          const count = a.slots.filter((sl) => sl.kind === slotKind && (slots[sl.name] ?? "").trim()).length;
          if (kind && count > prm.max) add(s.idx, tag, `${count} "${kind}" elements, rule allows ${prm.max}: "${r.text}"`);
        }
        if (m.type === "forbid" && typeof prm.pattern === "string") {
          const re = compile(prm.pattern);
          if (re) for (const [k, v] of Object.entries(slots)) if (re.test(plain(v))) add(s.idx, tag, `slot "${k}" breaks a rule ("${r.text}")`, k);
        }
      }
    }
  }

  const single = (spec.formats ?? []).some((f) => f.id === copy.format && f.kind === "single"); // a one-slide post has no sequence and no carousel-only rules
  // sequencing across slides (language/platform independent)
  const first = copy.slides[0], last = copy.slides[copy.slides.length - 1];
  let firstRule: string | undefined, lastRule: string | undefined;
  for (const r of single ? [] : rules) {
    const m = r.machine; if (m?.type !== "position_archetype") continue;
    const prm = m.params as any;
    if (prm.position === "first") { firstRule = prm.archetype_id; if (first && first.archetype !== prm.archetype_id) add(first.idx, "both", `the first slide must use archetype "${prm.archetype_id}": "${r.text}"`); }
    if (prm.position === "last") { lastRule = prm.archetype_id; if (last && last.archetype !== prm.archetype_id) add(last.idx, "both", `the last slide must use archetype "${prm.archetype_id}": "${r.text}"`); }
  }
  for (const r of single ? [] : rules) {
    const m = r.machine; if (m?.type !== "alternate_background") continue;
    const tokens: string[] = (m.params as any).tokens ?? [];
    const body = copy.slides.filter((s) => !(s === first && firstRule) && !(s === last && lastRule));
    let prevPos = -1;
    for (const s of body) {
      const bg = bgOf(s.archetype);
      if (!bg || !tokens.includes(bg)) { add(s.idx, "both", `background "${bg}" is not in the rotation [${tokens.join(", ")}]: "${r.text}"`); continue; }
      const pos = tokens.indexOf(bg);
      if (prevPos >= 0 && pos !== (prevPos + 1) % tokens.length) add(s.idx, "both", `backgrounds must rotate through [${tokens.join(" → ")}] but this slide follows the wrong one: "${r.text}"`);
      prevPos = pos;
    }
  }

  // look book slide roles (e.g. "Slide 1: the hook question + a stamp") and caption sources, straight from the register
  for (const g of (spec.guidelines ?? []).filter((x) => x.enabled && x.method === "code" && !(single && carouselOnly(x)))) {
    const P = (g.check?.params ?? {}) as any;
    if (g.check?.type === "slide_role" && (P.requires ?? []).length) {
      const idxs = P.position === "first" ? [1] : P.position === "last" ? [n] : Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 2);
      for (const i of idxs) {
        const sl = copy.slides.find((x) => x.idx === i); const a = sl && arch.get(sl.archetype); if (!sl || !a) continue;
        const slots = slotsFor(sl, "instagram"), stamp = a.slots.find((x) => x.kind === "stamp_text"), head = a.slots.find((x) => x.kind === "headline") ?? a.slots.find((x) => x.kind !== "tag");
        for (const r of P.requires as { kind: string; text?: string }[]) {
          if (r.kind === "question" && head && !/[?？]/.test(slots[head.name] ?? "")) add(i, "both", `look book: "${g.statement}". The headline must be a hook question (end it with a question mark)`, head.name);
          if (r.kind === "stamp") { if (!stamp) add(i, "both", `look book: "${g.statement}", but archetype "${sl.archetype}" has no stamp slot: use an archetype that has one`); else if (!(slots[stamp.name] ?? "").trim()) add(i, "both", `look book: "${g.statement}". Fill the "${stamp.name}" slot with a short stamp`, stamp.name); }
          if (r.kind === "phrase" && stamp && lang === "en" && !plain(slots[stamp.name] ?? "").toLowerCase().includes((r.text ?? "").toLowerCase())) add(i, "both", `look book: "${g.statement}". The stamp must read “${r.text}”`, stamp.name);
        }
      }
    }
    if (g.check?.type === "show_the_maths") {
      // figures on the slides must come with their working (e.g. ₹5,000 × 12 = ₹60,000)
      const EQ = /[₹$€£]?\d[\d,.]*[a-zA-Z%]*\s*[×x*÷/+\-−]\s*[₹$€£]?[\d,.]+[a-zA-Z%]*\s*=\s*[₹$€£]?\s*[\d,.]+/, FIG = /[₹$€£]\s?\d|\d\s?%/;
      const texts = copy.slides.map((sl) => Object.values(slotsFor(sl, "instagram")).join(" "));
      const withFig = copy.slides.filter((_, i) => FIG.test(texts[i]));
      if (withFig.length && !texts.some((t) => EQ.test(t))) add(withFig[0].idx, "both", `look book: "${g.statement}". Figures appear but no calculation is written out. Show the working explicitly on a slide, for example "₹5,000 × 12 = ₹60,000"`);
    }
    if (g.check?.type === "caption_sources" && !(copy.sources_note ?? "").trim()) add(0, "both", `look book: "${g.statement}". Provide sources_note: the assumptions or sources behind any figures`);
  }
  // captions
  for (const p of PLATFORM_IDS) {
    const c = copy.captions?.[p];
    if (!c || !c.text?.trim()) add(0, p, `${PLATFORMS[p].label} caption is empty`);
    else if (c.hashtags.length > PLATFORMS[p].maxHashtags) add(0, p, `${PLATFORMS[p].label} caption has ${c.hashtags.length} hashtags, max ${PLATFORMS[p].maxHashtags}`);
  }
  return issues;
}

/** Hard limits only (fast, per slide), used after inline edits and regeneration. */
export function validateSlide(s: SlideCopy, spec: StyleSpec, manifest: KitManifest, lang: Lang, n: number, all: SlideCopy[]): Issue[] {
  // a one-slide post is recognised by its template (the look book page its format comes from)
  const format = n === 1 ? (spec.formats ?? []).find((f) => f.kind === "single" && spec.archetypes.some((a) => a.id === s.archetype && a.source_page === f.page))?.id : undefined;
  const copy = { format, slides: all.map((x) => (x.idx === s.idx ? s : x)), captions: { instagram: { text: "x", hashtags: [] }, linkedin: { text: "x", hashtags: [] } } } as CopyData;
  return validateCopy(copy, spec, manifest, lang, n).filter((i) => i.idx === s.idx);
}

/**
 * Last-resort deterministic enforcement of hard text limits after the model's repair rounds: a rule such as "maximum 30 words per
 * slide" is never allowed to ship broken. The longest running-text slot is cut back to its last complete sentence (or word) that fits.
 * Returns the indexes of the slides it changed.
 */
export function capSlideWords(copy: { slides: SlideCopy[] }, spec: StyleSpec, manifest: KitManifest): number[] {
  const cap = Math.min(...[...spec.sequencing, ...spec.rules.filter((r) => r.enabled)].map((r) => r.machine).filter((m): m is { type: string; params: any } => !!m && m.type === "max_words_per_slide").map((m) => Number(m.params.max)).filter(Boolean));
  if (!Number.isFinite(cap)) return [];
  const changed: number[] = [];
  for (const s of copy.slides) {
    const a = manifest.archetypes.find((x) => x.id === s.archetype); if (!a) continue;
    for (const platform of PLATFORM_IDS) {
      const slots = { ...slotsFor(s, platform) }, total = () => Object.entries(slots).filter(([n]) => a.slots.some((x) => x.name === n && x.kind !== "counter" && !/count/i.test(x.name))).reduce((t, [, v]) => t + words(v).length, 0);
      let guard = 0;
      while (total() > cap && guard++ < 40) {
        const cands = a.slots.filter((x) => ["body", "list", "maths"].includes(x.kind) && !/option|choice|answer/i.test(x.name) && words(slots[x.name] ?? "").length > 3) // answer options are never cut: a clipped option is a wrong answer.sort((p, q) => words(slots[q.name]).length - words(slots[p.name]).length);
        const t = cands[0]; if (!t) break;
        const v = slots[t.name], over = total() - cap, sentences = v.split(/(?<=[.!?।])\s+/);
        let next = sentences.length > 1 && words(sentences.slice(0, -1).join(" ")).length >= 3 && words(v).length - words(sentences[sentences.length - 1]).length <= words(v).length - 1 ? sentences.slice(0, -1).join(" ") : v.split(/\s+/).slice(0, Math.max(3, words(v).length - over)).join(" ").replace(/[,;:\-–—]+$/, "");
        if (!/[.!?।]$/.test(next)) next += ".";
        if (next === v) break;
        slots[t.name] = next;
      }
      if (JSON.stringify(slots) !== JSON.stringify(slotsFor(s, platform))) { s.slots = platform === "instagram" || !s.overrides?.[platform] ? { ...s.slots, ...slots } : s.slots; if (platform !== "instagram" && s.overrides?.[platform]) s.overrides[platform] = { ...s.overrides[platform], ...slots }; changed.push(s.idx); }
    }
  }
  return [...new Set(changed)];
}
