// Turns the parsed look book anatomy into a GUIDELINE REGISTER: every statement the look book makes becomes an atomic
// guideline with its page, a verbatim quote and a declared way of being verified. The generator reads the register, the
// validators and the checklist enforce it. Wording-driven (the look book's own words), never keyed on a brand.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { getBrand, getLookbook, lookbookDir } from "../db/repo";
import { analyseLookbook, type Anatomy } from "./anatomy";
import { Guideline as GuidelineSchema, StyleSpec, type Format, type Guideline } from "./spec";

type G = Omit<Guideline, "id">;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/(ies)$/, "y").replace(/(s)$/, ""));
const sentenceCase = (s: string) => s.replace(/^\s*[a-z]/, (c) => c.toUpperCase()).replace(/[.;]\s*$/, "");

/** Resolve a colour mentioned in the look book's prose ("gold", "ledger paper", "green") to a named brand colour. */
export function resolveColour(a: Pick<Anatomy, "colours">, phrase: string): { name: string; hex: string } | null {
  const pw = words(phrase).filter((w) => !["the", "a", "an", "and", "on", "in", "bg", "background", "text", "post"].includes(w));
  if (!pw.length) return null;
  const scored = a.colours.map((c) => { const cw = words(c.name); return { c, full: pw.every((w) => cw.includes(w)), n: pw.filter((w) => cw.includes(w)).length }; }).filter((x) => x.n > 0);
  const full = scored.filter((x) => x.full);
  const pick = full.length === 1 ? full[0] : full.length > 1 ? null : scored.length === 1 ? scored[0] : scored.sort((x, y) => y.n - x.n)[0]?.n > (scored[1]?.n ?? 0) ? scored[0] : null;
  return pick ? { name: pick.c.name, hex: pick.c.hex } : null;
}

const FURNITURE_WORDS: [RegExp, string][] = [[/slide (count|counter|number)|counter|page number/i, "slide counter"], [/\btag\b|label/i, "tag"], [/\blogo\b/i, "logo"], [/handle|@/i, "handle"], [/\bfooter\b/i, "footer"]];
export function furnitureName(text: string): string | null { for (const [re, n] of FURNITURE_WORDS) if (re.test(text)) return n; return null; }

/** Classify one atomic rule from the carousel / rules bullets. */
function classifyRule(atom: string, a: Anatomy): Pick<G, "category" | "scope" | "method" | "check"> {
  const total = a.carousel?.slides ?? 5;
  let m: RegExpExecArray | null;
  // "Slide 1: the hook question + a stamp" / "Slides 2–4: one number or idea each" / "Slide 5: the fix + "Save this" stamp"
  if ((m = /^slides?\s+(\d+)(?:\s*[–-]\s*(\d+))?\s*(?::|\bis\b|\bare\b|\bmust be\b|\balways\b)\s*(.+)$/i.exec(atom))) {
    const from = +m[1], to = m[2] ? +m[2] : from, body = m[3];
    const position = from === 1 && to === 1 ? "first" : from === total && to === total ? "last" : "middle";
    const requires: { kind: string; text?: string }[] = [];
    if (/hook question|question/i.test(body)) requires.push({ kind: "question" });
    const phrase = /["“”']([^"“”']{3,30})["“”']/.exec(body)?.[1];
    if (/\bstamp\b|\bseal\b|\bsticker\b/i.test(body)) requires.push({ kind: "stamp" });
    if (phrase) requires.push({ kind: "phrase", text: phrase });
    // an explicit order: "Slide 3: the number on green", "Slide 2 is always paper"
    const bgMention = [...(a.colours ?? [])].map((c) => ({ c, at: body.toLowerCase().search(new RegExp(`\\b(?:on|in|with)?\\s*${c.name.toLowerCase().split(/\s+/).pop()}\\b(?:\\s+(?:slide|background|bg|post|page))?`)) })).filter((x) => x.at >= 0 && /\b(?:on|in|with|bg|background|slide|post|page|is|are)\b/i.test(body)).sort((x, y) => x.at - y.at)[0];
    if (bgMention && !/\bstamp\b/i.test(body.slice(Math.max(0, bgMention.at - 6), bgMention.at + 20))) requires.push({ kind: "background", text: bgMention.c.name, hex: bgMention.c.hex } as any);
    const roleOnly = /\bthe fix\b|\btakeaway\b|one (number|idea)/i.test(body);
    return { category: "structure", scope: "slide", method: requires.length ? "code" : "review", check: { type: "slide_role", params: { position, from, to, total, requires, text: body, role: roleOnly ? body : undefined } } };
  }
  if ((m = /^slides?\s+alternate\s+(.+?)\s+and\s+(.+)$/i.exec(atom))) {
    const x = resolveColour(a, m[1]), y = resolveColour(a, m[2]);
    return x && y ? { category: "design", scope: "carousel", method: "code", check: { type: "alternate_background", params: { colours: [x, y] } } } : { category: "design", scope: "carousel", method: "review" };
  }
  if ((m = /^(.+?)\s+(numbers?|text|type|headlines?|stamps?)\s+only\s+(?:on|in|for)\s+(.+)$/i.exec(atom)) || (m = /^()(.+?)\s+only\s+(?:on|in|for)\s+(.+)$/i.exec(atom))) {
    const accent = resolveColour(a, m[1] || m[2]), on = resolveColour(a, m[3]);
    if (accent && on) return { category: "design", scope: "slide", method: "code", check: { type: "color_only_on", params: { accent, on, element: /number/i.test(m[2]) ? "number" : /headline/i.test(m[2]) ? "headline" : /stamp/i.test(m[2]) ? "stamp_text" : "any" } } };
  }
  if ((m = /^max(?:imum)?\s+(?:of\s+)?(\d+)\s+words?/i.exec(atom))) return { category: "content", scope: "slide", method: "code", check: { type: "max_words_per_slide", params: { max: +m[1] } } };
  if ((m = /^(?:one|1|a single|only one)\s+(\w+)\s+(?:per|a|each|on a)\s+(?:slide|post)/i.exec(atom))) return { category: "design", scope: "slide", method: "code", check: { type: "max_elements_per_slide", params: { kind: m[1].toLowerCase(), max: 1 } } };
  if ((m = /^no\s+(.+)$/i.exec(atom))) {
    const what = m[1].toLowerCase();
    if (/photo|image|picture|face|people|person|stock|illustration|clip ?art|emoji icon/.test(what)) return { category: "design", scope: "slide", method: "template", check: { type: "forbid_visual", params: { what } } };
    return { category: "content", scope: "slide", method: /emoji/.test(what) ? "code" : "review", check: /emoji/.test(what) ? { type: "forbid_text", params: { pattern: "emoji", what } } : undefined };
  }
  if (/sources?\b.*\bcaption|caption\b.*\bsources?/i.test(atom)) return { category: "captions", scope: "caption", method: "code", check: { type: "caption_sources", params: {} } };
  const f = furnitureName(atom), pos = /\b(top|bottom|middle)[- ](left|right|centre|center)\b/i.exec(atom);
  if (f && pos) return { category: "design", scope: "slide", method: "code", check: { type: "furniture_present", params: { what: f, position: pos[0].toLowerCase().replace(" ", "-").replace("centre", "center") } } };
  return { category: "content", scope: "carousel", method: "review" };
}

function classifyVoice(s: string): Pick<G, "category" | "scope" | "method" | "check"> {
  if (/always show (the )?(maths?|math|calculation|working|numbers?|arithmetic)\b/i.test(s)) return { category: "voice", scope: "carousel", method: "code", check: { type: "show_the_maths", params: {} } };
  if (/hinglish.*(welcome|allowed|fine|ok)|(welcome|allowed).*hinglish/i.test(s)) return { category: "captions", scope: "caption", method: "info", check: { type: "permission", params: { note: "Hinglish may be used when the language is Hinglish" } } };
  return { category: "voice", scope: "carousel", method: "review" };
}

export function buildGuidelines(a: Anatomy): Guideline[] {
  const out: G[] = [];
  const add = (g: G) => out.push(g);

  // ---- carousel plan & rules (the ▸ bullets) ----
  for (const r of a.rules) for (const atom of r.atoms) add({ section: "Carousel rules", page: r.page, quote: r.text, statement: sentenceCase(atom), ...classifyRule(atom, a), enabled: true });

  // ---- voice ----
  if (a.voice) for (const s of a.voice.sentences) add({ section: "Voice", page: a.voice.page, quote: a.voice.text, statement: sentenceCase(s), ...classifyVoice(s), enabled: true });

  // ---- slide format ----
  const size = a.posts[0];
  if (size) add({ section: "Post format", page: size.page, quote: `${size.width} × ${size.height}`, statement: `Every slide is ${size.width} × ${size.height} px`, category: "design", scope: "slide", method: "code", check: { type: "slide_size", params: { w: size.width, h: size.height } }, enabled: true });

  // ---- colours ----
  if (a.colours.length) add({ section: "Brand colours", page: a.colours[0].page, quote: a.colours.map((c) => `${c.name} ${c.hex}`).join(" · "), statement: `Use only the brand palette: ${a.colours.map((c) => titleCase(c.name)).join(", ")}`, category: "design", scope: "slide", method: "code", check: { type: "palette_only", params: { colours: a.colours.map((c) => ({ name: c.name, hex: c.hex })) } }, enabled: true });
  for (const c of a.colours) {
    const text = `${c.name}: ${c.usage}`;
    add({ section: "Brand colours", page: c.page, quote: `${c.name} ${c.hex} · ${c.usage}`, statement: `${titleCase(c.name)} (${c.hex}) is for: ${c.roles.map((r) => r.toLowerCase()).join(", ")}`, category: "design", scope: "slide", method: "code", check: { type: "colour_usage", params: { name: c.name, hex: c.hex, roles: c.roles } }, enabled: true });
    void text;
  }

  // ---- type ----
  for (const t of a.type) add({ section: "Type", page: t.page, quote: t.caption, statement: `${titleCase(t.family)}${t.weights.length ? ` ${t.weights.join("/")}` : ""} is for ${t.roles.map((r) => r.toLowerCase()).join(", ")}`, category: "design", scope: "slide", method: "code", check: { type: "fonts_by_role", params: { family: t.family, roles: t.roles } }, enabled: true });

  // ---- elements ----
  for (const e of a.elements) {
    const isLogo = /logo/i.test(e.name);
    add({ section: "Elements", page: e.page, quote: e.caption, statement: sentenceCase(`${titleCase(e.name)}${e.modifier ? `, ${e.modifier.toLowerCase()}` : ""}`), category: "design", scope: "slide", method: "template", check: { type: isLogo ? "logo_asset" : "element_present", params: { name: e.name, rotation: e.rotation, placement: e.placement } }, enabled: true });
  }
  if (a.logo) add({ section: "Logo", page: a.logo.page, quote: a.logo.rule, statement: sentenceCase((a.logo.usage ?? a.logo.rule).toLowerCase()), category: "brand", scope: "slide", method: "template", check: { type: "logo_asset", params: { usage: a.logo.usage } }, enabled: true });

  // ---- feed rules: which pillar sits on which background ----
  for (const f of a.profile?.feedRules ?? []) {
    const m = /^(.+?)\s+on\s+(.+)$/i.exec(f);
    const colour = m ? resolveColour(a, m[2]) : null;
    if (m && colour) add({ section: "Feed", page: a.profile?.page ?? 1, quote: f, statement: sentenceCase(f.toLowerCase()), category: "design", scope: "slide", method: "template", check: { type: "pillar_background", params: { stem: words(m[1])[0], colour } }, enabled: true });
    else add({ section: "Feed", page: a.profile?.page ?? 1, quote: f, statement: sentenceCase(f.toLowerCase()), category: "structure", scope: "carousel", method: "info", enabled: true });
  }

  // ---- formats / pillars ----
  for (const p of a.pillars) add({ section: "Content pillars", page: p.page, quote: `${p.name} · ${p.description} · ${p.label}`, statement: `${p.name}: ${p.description} (${p.kind === "carousel" ? "carousel" : "single post"})`, category: "structure", scope: "carousel", method: "info", check: { type: "format", params: { name: p.name, kind: p.kind } }, enabled: true });
  if (a.cadence) add({ section: "Content pillars", page: a.pillars[0]?.page ?? 2, quote: a.cadence, statement: `Cadence: ${a.cadence.toLowerCase()}`, category: "brand", scope: "brand", method: "info", enabled: true });
  if (a.profile?.tagline.length) add({ section: "Profile", page: a.profile.page ?? 1, quote: a.profile.tagline.join(" "), statement: `Brand line: ${a.profile.tagline.join(" ")}`, category: "brand", scope: "brand", method: "info", enabled: true });

  return out.map((g, i) => GuidelineSchema.parse({ ...g, id: `g${String(i + 1).padStart(2, "0")}` }));
}
const titleCase = (s: string) => s.split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? w : w.length <= 2 && /^[A-Za-z]+$/.test(w) && w === w.toUpperCase() ? w : w.toLowerCase().replace(/(^|-)([a-z])/g, (_, p, c) => p + c.toUpperCase()))).join("");

export function buildFormats(a: Anatomy): Format[] {
  return a.pillars.map((p) => ({ id: slug(p.name), name: p.name, description: p.description, kind: p.kind, label: p.label, slides: p.kind === "carousel" ? Number(/(\d+)[- ]slide/i.exec(p.description)?.[1] ?? a.carousel?.slides ?? 0) || undefined : undefined, stamped: /stamp|seal|sticker/i.test(p.description), page: a.posts.find((x) => slug(x.pillar) === slug(p.name))?.page }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Which look book page each template should be measured against. The anatomy knows exactly where the cover, the
 * "inside the carousel" slides and each single post live, so this is not left to the model (which often omits it,
 * leaving the most important template, the cover, ungrounded).
 */
export function assignSourcePages(s: StyleSpec, a: Anatomy): void {
  const cover = a.carousel?.coverPage, inside = a.carousel?.insidePage, unused = [...a.posts];
  const stemWords = (t: string) => words(t).filter((w) => w.length > 2 && !["the", "post", "slide", "carousel", "page"].includes(w));
  const rest: StyleSpec["archetypes"] = [];
  for (const arch of s.archetypes) {
    const txt = `${arch.id} ${arch.purpose}`.toLowerCase();
    if (cover && /cover|hook|first/.test(txt)) arch.source_page = cover;
    else if (/clos|outro|last|end/.test(txt)) arch.source_page = undefined; // the look book never draws the closing slide: nothing to measure it against
    else if (inside && /cta|inside|body|middle|inner/.test(txt)) arch.source_page = inside;
    else rest.push(arch);
  }
  for (const arch of rest) {
    const aw = stemWords(`${arch.id} ${arch.purpose}`);
    const hit = unused.findIndex((p) => stemWords(p.pillar).some((w) => aw.some((x) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))));
    if (hit >= 0) { arch.source_page = unused[hit].page; unused.splice(hit, 1); }
  }
  for (const arch of rest) if (!a.posts.some((p) => p.page === arch.source_page) && unused.length) arch.source_page = unused.shift()!.page; // remaining single-post templates, in page order
}

/**
 * Merge everything parsed from the look book into the Style Spec without losing anything the model produced:
 * colour names/roles, font roles, voice statements, furniture, formats, guidelines and the machine rules they imply.
 */
/**
 * A post whose sample shows lettered answer boxes (A, B, C, D) needs one slot per option. The vision model sometimes returns a
 * single "options" slot, which the template then repeats in every box. The look book's own page tells us how many options there are.
 */
export function expandOptionSlots(s: StyleSpec, a: Anatomy): string[] {
  const changes: string[] = [];
  for (const post of a.posts) {
    const letters = post.sample.filter((t) => /^[A-F]$/.test(t.trim())).map((t) => t.trim()); if (letters.length < 3) continue;
    const arch = s.archetypes.find((x) => x.source_page === post.page); if (!arch) continue;
    const have = arch.slots.filter((x) => /option|choice|answer/i.test(x.name));
    if (have.length >= letters.length) continue;
    const proto = have[0] ?? { kind: "body", max_words: 6, max_chars: 40, optional: false } as any;
    const at = have.length ? arch.slots.indexOf(have[0]) : arch.slots.length;
    const made = letters.map((l) => ({ ...proto, name: `option-${l.toLowerCase()}`, kind: proto.kind === "list" ? "body" : proto.kind, max_words: Math.max(5, Math.min(proto.max_words ?? 6, 7)), max_chars: Math.max(32, Math.min(proto.max_chars ?? 40, 48)), optional: false }));
    arch.slots = [...arch.slots.slice(0, at), ...made, ...arch.slots.filter((x, i) => i >= at && !have.includes(x))];
    changes.push(`${arch.id}: ${have.map((x) => x.name).join(",") || "no option slot"} → ${made.map((x) => x.name).join(", ")}`);
  }
  return changes;
}

export function reconcileSpec(spec: StyleSpec, a: Anatomy, opts: { furniture?: boolean } = {}): StyleSpec {
  const s: StyleSpec = JSON.parse(JSON.stringify(spec));
  // colours: keep existing tokens (kits reference them) and attach the look book's names + roles
  for (const c of a.colours) {
    const hit = s.colors.find((x) => x.hex.toUpperCase() === c.hex.toUpperCase());
    if (hit) { hit.name = c.name; hit.roles = c.roles; if (!hit.usage_notes) hit.usage_notes = c.usage; }
    else s.colors.push({ token: slug(c.name), hex: c.hex, role: (c.roles[0] ?? "accent").toLowerCase(), usage_notes: c.usage, name: c.name, roles: c.roles });
  }
  // fonts: attach usage roles to the matching family
  for (const t of a.type) {
    const hit = s.fonts.find((f) => [f.family, f.google_fonts_family ?? ""].some((n) => norm(n) === norm(t.family)));
    if (hit) { hit.roles = t.roles; if (t.weights.length) hit.weights = [...new Set([...hit.weights, ...t.weights])].sort((x, y) => x - y); }
    else s.fonts.push({ role: slug(t.roles[0] ?? t.family), family: titleCase(t.family), weights: t.weights.length ? t.weights : [400], devanagari_pair: "Noto Sans Devanagari", substituted: false, roles: t.roles });
  }
  // voice
  if (a.voice) { s.voice.statements = a.voice.sentences; if (!s.voice.summary || s.voice.summary.length < 20) s.voice.summary = a.voice.text; }
  // furniture from the "tag top-left, slide count top-right ..." rules
  const gl = buildGuidelines(a);
  if (opts.furniture !== false) {
    for (const g of gl.filter((x) => x.check?.type === "furniture_present")) {
      const what = String(g.check!.params.what), position = String(g.check!.params.position);
      const hit = s.layout.fixed_furniture.find((f) => furnitureName(f.what) === what);
      if (hit) hit.position = position; else s.layout.fixed_furniture.push({ what, position });
    }
  }
  // elements: attach the look book caption / rotation
  for (const e of a.elements) {
    const ew = words(e.name), hit = s.elements.find((x) => words(`${x.id} ${x.kind} ${x.description}`).some((w) => ew.includes(w)));
    if (hit) { if (e.rotation !== undefined && hit.rotation_deg === undefined) hit.rotation_deg = e.rotation; }
  }
  assignSourcePages(s, a);
  expandOptionSlots(s, a);
  s.formats = buildFormats(a);
  s.guidelines = gl;
  s.lookbook = { concept: a.concept, cadence: a.cadence, name: a.profile?.name, handle: a.profile?.handle, tagline: a.profile?.tagline ?? [], highlights: a.profile?.highlights ?? [], feedRules: a.profile?.feedRules ?? [], slides: a.carousel?.slides, motto: a.carousel?.motto, coverPage: a.carousel?.coverPage, insidePage: a.carousel?.insidePage, logo: a.logo ? { description: a.logo.description, usage: a.logo.usage } : undefined, coverage: a.coverage, warnings: a.warnings };
  if (!s.brand.handle && a.profile?.handle) s.brand.handle = a.profile.handle;
  if (!s.brand.name && a.profile?.name) s.brand.name = a.profile.name;

  // machine rules implied by guidelines (so every existing validator sees them), without duplicating the model's own
  const have = (type: string, key?: string, val?: unknown) => [...s.rules, ...s.sequencing].some((r) => r.machine?.type === type && (key === undefined || JSON.stringify((r.machine.params as any)[key]) === JSON.stringify(val)));
  const tokenOf = (hex: string) => s.colors.find((c) => c.hex.toUpperCase() === hex.toUpperCase())?.token;
  for (const g of gl) {
    const c = g.check; if (!c) continue;
    const P = c.params as any;
    if (c.type === "max_words_per_slide" && !have("max_words_per_slide")) s.rules.push({ text: g.statement, enabled: true, machine: { type: "max_words_per_slide", params: { max: P.max } } });
    if (c.type === "max_elements_per_slide" && !have("max_elements_per_slide", "element_kind", P.kind)) s.rules.push({ text: g.statement, enabled: true, machine: { type: "max_elements_per_slide", params: { element_kind: P.kind, max: P.max } } });
    if (c.type === "alternate_background" && !have("alternate_background")) { const t = (P.colours as { hex: string }[]).map((x) => tokenOf(x.hex)).filter(Boolean); if (t.length === 2) s.sequencing.push({ rule: g.statement, machine: { type: "alternate_background", params: { tokens: t } } }); }
    if (c.type === "color_only_on" && !have("color_only_on")) { const a1 = tokenOf(P.accent.hex), a2 = tokenOf(P.on.hex); if (a1 && a2) s.rules.push({ text: g.statement, enabled: true, machine: { type: "color_only_on", params: { color_token: a1, background_tokens: [a2] } } }); }
  }
  return StyleSpec.parse(s);
}

/** Deterministic upgrade of a stored look book: re-read its PDF, rebuild the register, keep everything else. */
export async function upgradeLookbook(lookbookId: number, opts: { furniture?: boolean } = { furniture: false }): Promise<{ guidelines: number; coverage: { blocks: number; mapped: number }; warnings: string[] }> {
  const lb = getLookbook(lookbookId); if (!lb?.spec_json) throw new Error("This look book has no spec yet.");
  const a = await analyseLookbook(lb.source_path);
  const spec = reconcileSpec(StyleSpec.parse(JSON.parse(lb.spec_json)), a, opts);
  const dir = lookbookDir(getBrand(lb.brand_id)!.slug, lb.version);
  await fs.writeFile(path.join(dir, "anatomy.json"), JSON.stringify(a, null, 1));
  await fs.writeFile(path.join(dir, "spec.json"), JSON.stringify(spec, null, 2));
  db().prepare("UPDATE lookbooks SET spec_json=? WHERE id=?").run(JSON.stringify(spec), lookbookId);
  return { guidelines: spec.guidelines.length, coverage: a.coverage, warnings: a.warnings };
}

/** Make sure a look book has its register (older ingests don't). Cheap, free, idempotent. */
export async function ensureGuidelines(lookbookId: number): Promise<void> {
  const lb = getLookbook(lookbookId);
  if (!lb?.spec_json) return;
  const spec = JSON.parse(lb.spec_json);
  if ((spec.guidelines ?? []).length && spec.lookbook?.insidePage !== undefined) return; // register is current
  await upgradeLookbook(lookbookId);
}
export { z };
