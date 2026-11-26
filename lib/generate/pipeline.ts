import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getBrand, listLookbooks } from "../db/repo";
import { createCarousel, getCarousel, saveCopy, setStatus, upsertSlide, listSlides, carouselDir, setRenderInfo, getRenderInfo, type CopyData, type Flags, type Lang, type SlideCopy, type RenderInfo } from "../db/carousels";
import { loadCtx, loadCtxForCarousel, type Ctx } from "./ctx";
import { generateCopy, buildSystem, requirementsText, slideSchemaText, RepairSchema, SlideSchema } from "./plan";
import { applyPlan, fixCounters, singleOf } from "./plan";
import { assertCredits } from "../llm/preflight";
import { capSlideWords, validateCopy, validateSlide, slotsFor, words, plain, type Issue } from "./validate";
import { PLATFORM_IDS, LANGUAGES, type PlatformId } from "./platforms";
import { renderSlide } from "../render/renderer";
import { exportCarousel } from "../render/export";
import { improveCover } from "./cover";
import { reviewCompliance, evaluateChecklist } from "./checklist";
import { ensureGuidelines } from "../ingest/guidelines";
import { llmCall } from "../llm/router";

export type Progress = (stage: string, detail?: string) => void;
const pad = (i: number) => String(i).padStart(2, "0");

/** Text integrity / font failures are never user-fixable flags: they mean the render can't be trusted. */
export class RenderIntegrityError extends Error {}

/** Problems already present when the kit was built are template defects, not something the user's copy caused. */
const known = new Map<string, Record<string, string[]>>();
function knownProblems(ctx: Ctx, archetype: string): string[] {
  if (!known.has(ctx.kitDir)) { try { known.set(ctx.kitDir, JSON.parse(readFileSync(path.join(ctx.kitDir, "report.json"), "utf8")).renderProblems ?? {}); } catch { known.set(ctx.kitDir, {}); } }
  return known.get(ctx.kitDir)![archetype] ?? [];
}
const handleFor = (ctx: Ctx, p: PlatformId) => (p === "linkedin" ? ctx.spec.brand.linkedin_handle ?? ctx.spec.brand.handle : ctx.spec.brand.handle) ?? "";

/** Render one slide for both platforms (once if nothing differs), write the PNGs, return issues found by the render checks. */
async function renderPair(ctx: Ctx, dir: string, s: SlideCopy, total: number, caps?: Record<string, number>): Promise<{ issues: Issue[]; ig: string; li: string; info: Partial<Record<PlatformId, RenderInfo>> }> {
  const png: Partial<Record<PlatformId, Buffer>> = {}, info: Partial<Record<PlatformId, RenderInfo>> = {};
  const kinds = Object.fromEntries((ctx.manifest.archetypes.find((a) => a.id === s.archetype)?.slots ?? []).map((x) => [x.name, x.kind]));
  const issues: Issue[] = [];
  const inputs = (p: PlatformId) => JSON.stringify([slotsFor(s, p), handleFor(ctx, p)]);
  for (const p of PLATFORM_IDS) {
    if (p === "linkedin" && inputs("linkedin") === inputs("instagram")) { png.linkedin = png.instagram; info.linkedin = info.instagram; continue; }
    const r = await renderSlide({ kitDir: ctx.kitDir, manifest: ctx.manifest, archetypeId: s.archetype, slots: slotsFor(s, p), polish: true, caps, vars: { idx: s.idx, total, handle: handleFor(ctx, p), brand: ctx.spec.brand.name } });
    png[p] = r.png;
    info[p] = { slots: Object.fromEntries(Object.entries(r.diag.slots).map(([n, x]) => [n, { kind: kinds[n] ?? "", ff: x.ff ?? "", color: x.color ?? "", size: x.size, bg: x.bg ?? "", bd: x.bd ?? "" }])), furniture: r.diag.furniture, furnitureMisplaced: r.diag.furnitureMisplaced, collisions: r.diag.collisions, rootBg: r.diag.rootBg ?? "" };
    for (const prob of r.problems) {
      if (/^(TEXT_INTEGRITY|FONT_LOAD)/.test(prob)) throw new RenderIntegrityError(`Slide ${s.idx} (${p}): ${prob}`);
      const slot = /slot "([^"]+)"/.exec(prob)?.[1];
      if (knownProblems(ctx, s.archetype).includes(prob)) continue; // template defect that existed at ingest
      if (prob.startsWith("OVERFLOW") && slot) {
        // overflow with copy already inside the slot's budget means the template box is too small: not fixable by rewriting
        const sl = ctx.manifest.archetypes.find((a) => a.id === s.archetype)?.slots.find((x) => x.name === slot), v = slotsFor(s, p)[slot] ?? "";
        if (sl && words(v).length <= sl.max_words && [...plain(v)].length <= sl.max_chars) continue;
      }
      if (/^Furniture:/.test(prob)) continue; // furniture position does not depend on the copy: template-level
      issues.push({ idx: s.idx, platform: p, slot, msg: prob.startsWith("OVERFLOW") ? `slot "${slot}": text does not fit the template even at its smallest size; shorten it` : `layout: ${prob}` });
    }
  }
  const rel = (k: string) => path.join(k, `${pad(s.idx)}.png`);
  for (const [k, p] of [["ig", "instagram"], ["li", "linkedin"]] as const) { await fs.mkdir(path.join(dir, k), { recursive: true }); await fs.writeFile(path.join(dir, rel(k)), png[p as PlatformId]!); }
  return { issues, ig: rel("ig"), li: rel("li"), info };
}

const flagsFrom = (issues: Issue[]): Flags => {
  const f: Flags = {};
  for (const i of issues) (f[String(i.idx)] ??= []).push(`${i.platform === "both" ? "" : `[${i.platform}] `}${i.msg}`);
  for (const k of Object.keys(f)) f[k] = [...new Set(f[k])];
  return f;
};

async function repairCall(ctx: Ctx, carouselId: number, copy: CopyData, issues: Issue[], lang: Lang, n: number, topic: string) {
  const full = issues.some((i) => i.idx === 0 && /expected \d+ slides/.test(i.msg));
  const bad = [...new Set(issues.filter((i) => i.idx > 0).map((i) => i.idx))];
  const capIssues = issues.filter((i) => i.idx === 0 && !full);
  const { system } = await buildSystem(ctx.spec, ctx.manifest);
  const parts: string[] = [`REPAIR for the carousel on "${topic}" (${LANGUAGES[lang]}, ${n} slides). Requirements:\n${requirementsText(ctx.spec, n, ctx.manifest, singleOf(ctx.spec, copy.format))}`];
  if (full) parts.push(`The slide count is wrong. Return ALL ${n} slides, keeping good ones as they are.`);
  else parts.push(`Return ONLY the failing slides listed below (same idx), corrected. Keep everything that already works. You may change a slide's archetype only if a violation is about archetype or background order.`);
  for (const idx of full ? copy.slides.map((s) => s.idx) : bad) {
    const s = copy.slides.find((x) => x.idx === idx)!; if (!s) continue;
    const vs = issues.filter((i) => i.idx === idx).map((i) => `- ${i.platform !== "both" ? `[${i.platform}] ` : ""}${i.msg}`);
    parts.push(`Slide ${idx} (archetype ${s.archetype}; budgets: ${slideSchemaText(ctx.manifest, s.archetype)})\nCurrent: ${JSON.stringify({ slots: s.slots, overrides: s.overrides })}\n${vs.length ? "Violations:\n" + vs.join("\n") : "(ok)"}`);
  }
  if (capIssues.length) parts.push(`Caption-level problems: ${capIssues.map((i) => i.msg).join("; ")}. Return the corrected fields too: `+ "`sources_note` and/or `captions` (both platforms) as needed.");
  return llmCall({ stage: "carousel.repair", tier: "text_strong", system, user: parts.join("\n\n"), schema: RepairSchema, carouselId, maxOutTokens: 6000, thinking: 1500 });
}

export async function generateCarousel(opts: { brandId: number; topic: string; n: number; language: Lang; coverVariants?: boolean; format?: string }, progress: Progress = () => {}): Promise<{ carouselId: number; repairs: number; flags: Flags }> {
  const { brandId, topic, language } = opts; let n = opts.n;
  if (!topic.trim()) throw new Error("A topic is required.");
  const brand = getBrand(brandId); if (!brand) throw new Error("Brand not found");
  const lb = listLookbooks(brandId).find((l) => l.is_active) ?? listLookbooks(brandId)[0];
  if (!lb) throw new Error("This brand has no look book yet.");
  await assertCredits(Number(process.env.CAROUSEL_PREFLIGHT_USD ?? 0.2), "this carousel");
  await ensureGuidelines(lb.id); // older look books get their register (free, deterministic)
  const ctx = loadCtx(lb.id);
  const single = singleOf(ctx.spec, opts.format); // a one-slide look book format (e.g. the quiz) instead of a carousel
  if (single) n = 1; else if (n < 3 || n > 10) throw new Error("Slides must be between 3 and 10.");
  const id = createCarousel(brandId, lb.id, topic.trim(), n, language);
  const dir = carouselDir(brand.slug, id);
  try {
    progress("copy", "Writing the copy: one cheap call for both platforms");
    const { data } = await generateCopy({ spec: ctx.spec, manifest: ctx.manifest, topic: topic.trim(), n, lang: language, carouselId: id, format: opts.format });
    let copy: CopyData = { ...data, slides: [...data.slides].sort((a, b) => a.idx - b.idx) };
    if (copy.format && !ctx.spec.formats.some((f) => f.id === copy.format)) copy.format = ctx.spec.formats.find((f) => f.kind === "carousel")?.id; // unknown id from the model

    if (single) { copy.format = single.format.id; copy.slides = copy.slides.slice(0, 1).map((x) => ({ ...x, idx: 1, archetype: single.archetype })); } // the template of a single post is fixed by the look book page it comes from
    applyPlan(copy.slides, ctx.spec, ctx.manifest); fixCounters(copy.slides, ctx.manifest);
    progress("validate", "Checking word limits, rules and script");
    let issues = validateCopy(copy, ctx.spec, ctx.manifest, language, n);
    progress("render", "Rendering slides for Instagram and LinkedIn");
    const files = new Map<number, { ig: string; li: string; info: Partial<Record<PlatformId, RenderInfo>> }>();
    const renderIssues = async (slides: SlideCopy[]) => { const out: Issue[] = []; for (const s of slides) { if (!ctx.manifest.archetypes.some((a) => a.id === s.archetype)) continue; const r = await renderPair(ctx, dir, s, copy.slides.length); files.set(s.idx, { ig: r.ig, li: r.li, info: r.info }); out.push(...r.issues); } return out; };
    issues = [...issues, ...(await renderIssues(copy.slides))];

    let repairs = 0;
    for (let round = 0; round < 2 && issues.length; round++) { // a second round only if the first repair left hard violations
      progress("repair", `Rewriting only the ${new Set(issues.map((i) => i.idx)).size} failing part(s) in one call`);
      repairs = round + 1;
      try {
        const { data: fix } = await repairCall(ctx, id, copy, issues, language, n, topic);
        const changed = new Set<number>();
        for (const s of fix.slides) { const k = copy.slides.findIndex((x) => x.idx === s.idx); if (k >= 0) { copy.slides[k] = s; changed.add(s.idx); } else if (issues.some((i) => /expected \d+ slides/.test(i.msg))) { copy.slides = fix.slides.sort((a, b) => a.idx - b.idx); fix.slides.forEach((x) => changed.add(x.idx)); break; } }
        if (fix.sources_note?.trim()) copy.sources_note = fix.sources_note.trim();
        if (fix.captions?.instagram) copy.captions.instagram = fix.captions.instagram;
        if (fix.captions?.linkedin) copy.captions.linkedin = fix.captions.linkedin;
        progress("render", "Re-rendering the repaired slides");
        const again = validateCopy(copy, ctx.spec, ctx.manifest, language, n);
        const rr = await renderIssues(copy.slides.filter((s) => changed.has(s.idx)));
        const keepOldRender = issues.filter((i) => !changed.has(i.idx) && /layout:|does not fit/.test(i.msg));
        issues = [...again, ...rr, ...keepOldRender];
      } catch (e: any) { progress("repair", `Repair failed (${String(e.message).slice(0, 120)}); keeping the first draft and flagging the issues`); }
    }
    // cover director: alternatives are written, rendered, filtered by the same checks and judged; the winner replaces slide 1
    if (opts.coverVariants !== false && !single) {
      const cv = await improveCover(ctx, id, copy, language, topic.trim(), progress);
      if (cv) {
        copy.cover = { considered: cv.considered, picked: cv.picked, angle: cv.angle, reason: cv.reason };
        if (cv.chosen !== copy.slides[0]) {
          copy.slides[0] = cv.chosen;
          issues = issues.filter((i) => i.idx !== 1);
          issues.push(...validateSlide(cv.chosen, ctx.spec, ctx.manifest, language, n, copy.slides), ...(await renderIssues([cv.chosen])));
        }
      }
    }
    fixCounters(copy.slides, ctx.manifest); // repairs and the cover director may have rewritten a counter
    // consistent type size across the inside slides
    {
      const sizes = new Map<number, Record<string, { kind: string; size: number }>>();
      for (const sl of copy.slides) { const i = files.get(sl.idx)?.info.instagram; if (i) sizes.set(sl.idx, Object.fromEntries(Object.entries(i.slots).map(([k, v]) => [k, { kind: v.kind, size: v.size }]))); }
      const caps = sizeCapsFor(ctx, copy.slides, sizes);
      for (const sl of copy.slides) { const c = caps.get(sl.idx); if (!c) continue; const r = await renderPair(ctx, dir, sl, copy.slides.length, c); files.set(sl.idx, { ig: r.ig, li: r.li, info: r.info }); }
      if (caps.size) progress("render", `Matching type sizes across ${caps.size} slide(s)`);
    }
    // hard limits never ship broken: whatever the model left over the cap is cut back in code, then re-checked
    {
      const cut = capSlideWords(copy, ctx.spec, ctx.manifest);
      if (cut.length) {
        progress("repair", `Trimming ${cut.length} slide(s) to the word limit`);
        const again = await renderIssues(copy.slides.filter((x) => cut.includes(x.idx)));
        issues = [...validateCopy(copy, ctx.spec, ctx.manifest, language, n), ...again, ...issues.filter((i) => !cut.includes(i.idx) && /layout:|does not fit/.test(i.msg))];
      }
    }
    const flags = flagsFrom(issues);
    saveCopy(id, copy, flags);
    for (const s of copy.slides) { const f = files.get(s.idx)!; upsertSlide(id, s.idx, s.archetype, f.ig, f.li, s.overrides); setRenderInfo(id, s.idx, f.info); }
    progress("export", "Building PDFs, ZIP and captions");
    await exportAll(id);
    progress("review", "Checking the carousel against every look book guideline");
    try { await reviewCompliance(id); } catch (e: any) { progress("review", `AI review unavailable (${String(e.message).slice(0, 90)}); code and template checks still run`); }
    // one self-correction pass: guidelines the review says were broken on specific slides are fixed in a single repair call
    try {
      const cl = await evaluateChecklist(id);
      const fails = cl.items.filter((i) => i.status === "fail" && (i.slides.length || ["captions", "voice"].includes(i.category)) && i.by !== "template" && i.id !== "q-readable");
      if (fails.length) {
        progress("repair", `Fixing ${fails.length} guideline miss(es) the review found`);
        const sIssues: Issue[] = fails.flatMap((f) => { const msg = `look book "${f.statement}" is broken here: ${f.evidence}${f.fix ? `. Fix: ${f.fix}` : ""}`, on = f.slides.filter((x) => copy.slides.some((s) => s.idx === x)); return on.length ? on.map((idx) => ({ idx, platform: "both" as const, msg })) : [{ idx: 0, platform: "both" as const, msg }]; });
        if (sIssues.length) {
          const { data: fix } = await repairCall(ctx, id, copy, sIssues, language, n, topic);
          const changed = new Set<number>(), keep = copy.slides.map((x) => JSON.stringify(x));
          let capsChanged = false; if (sIssues.some((i) => i.idx === 0)) { if (fix.captions?.instagram) { copy.captions.instagram = fix.captions.instagram; capsChanged = true; } if (fix.captions?.linkedin) { copy.captions.linkedin = fix.captions.linkedin; capsChanged = true; } if (fix.sources_note?.trim()) { copy.sources_note = fix.sources_note.trim(); capsChanged = true; } }
          for (const s2 of fix.slides) { const k = copy.slides.findIndex((x) => x.idx === s2.idx); if (k >= 0 && sIssues.some((i) => i.idx === s2.idx) && !validateSlide(s2, ctx.spec, ctx.manifest, language, n, copy.slides).length) { copy.slides[k] = s2; changed.add(s2.idx); } }
          if (capsChanged && !changed.size) { saveCopy(id, copy, flags); await exportAll(id); await reviewCompliance(id); }
          if (changed.size) {
            const rr = await renderIssues(copy.slides.filter((x) => changed.has(x.idx)));
            if (rr.length) { copy.slides = copy.slides.map((x, k) => (changed.has(x.idx) ? JSON.parse(keep[k]) : x)); await renderIssues(copy.slides.filter((x) => changed.has(x.idx))); } // keep the original if the fix broke the layout
            saveCopy(id, copy, flags);
            for (const s2 of copy.slides) { const f = files.get(s2.idx)!; upsertSlide(id, s2.idx, s2.archetype, f.ig, f.li, s2.overrides); setRenderInfo(id, s2.idx, f.info); }
            await exportAll(id); await reviewCompliance(id);
          }
        }
      }
    } catch (e: any) { progress("review", `Self-correction skipped (${String(e.message).slice(0, 90)})`); }
    // final flags reflect the FINAL copy (the self-correction pass may have fixed or changed slides after the first check)
    const finalFlags = flagsFrom([...validateCopy(copy, ctx.spec, ctx.manifest, language, n), ...issues.filter((i) => /layout:|does not fit/.test(i.msg) && !validateCopy(copy, ctx.spec, ctx.manifest, language, n).some((v) => v.idx === i.idx && v.msg === i.msg))]);
    saveCopy(id, copy, finalFlags);
    setStatus(id, Object.keys(finalFlags).length ? "needs_review" : "ready");
    progress("done", Object.keys(finalFlags).length ? `${Object.keys(finalFlags).length} slide(s) flagged for review` : "Ready");
    return { carouselId: id, repairs, flags: finalFlags };
  } catch (e) {
    setStatus(id, "failed");
    throw e;
  }
}

/**
 * One type size per role across a carousel. Each slide's text is fitted on its own, so the same headline or body drifts from slide to
 * slide with copy length. Inside slides (not the cover or the closer) are brought to the typical size: bigger ones are capped, and slides
 * that genuinely need smaller text (long copy) keep it. Pure render work: no model call.
 */
export function sizeCapsFor(ctx: Ctx, slides: SlideCopy[], sizes: Map<number, Record<string, { kind: string; size: number }>>): Map<number, Record<string, number>> {
  const n = slides.length, inside = slides.filter((s) => s.idx !== 1 && s.idx !== n);
  const out = new Map<number, Record<string, number>>();
  if (inside.length < 2) return out;
  for (const kind of ["headline", "number", "body"]) {
    const entries = inside.flatMap((s) => Object.entries(sizes.get(s.idx) ?? {}).filter(([, v]) => v.kind === kind && v.size > 0).map(([name, v]) => ({ idx: s.idx, name, size: v.size })));
    if (entries.length < 2) continue;
    const sorted = entries.map((e) => e.size).sort((a, b) => a - b), target = sorted[Math.floor((sorted.length - 1) / 2)]; // lower median
    for (const e of entries) if (e.size > target + 1) out.set(e.idx, { ...(out.get(e.idx) ?? {}), [e.name]: target });
  }
  return out;
}

export async function exportAll(carouselId: number) {
  const { carousel, ctx } = loadCtxForCarousel(carouselId);
  const dir = carouselDir(ctx.brand.slug, carouselId);
  const slides = listSlides(carouselId);
  return exportCarousel(dir, carousel, slides.map((s) => path.join(dir, s.png_ig!)), slides.map((s) => path.join(dir, s.png_li!)));
}

/** Inline text edit: validated and re-rendered in code. No LLM call, so it costs ₹0. */
export async function editSlideText(carouselId: number, idx: number, edit: { platform: PlatformId | "both"; slot: string; text: string }) {
  const { carousel, ctx } = loadCtxForCarousel(carouselId);
  const copy = carousel.copy!, k = copy.slides.findIndex((s) => s.idx === idx);
  if (k < 0) throw new Error("Slide not found");
  const s: SlideCopy = JSON.parse(JSON.stringify(copy.slides[k]));
  if (!ctx.manifest.archetypes.find((a) => a.id === s.archetype)?.slots.some((x) => x.name === edit.slot)) throw new Error(`Unknown slot "${edit.slot}"`);
  if (edit.platform === "both") { s.slots[edit.slot] = edit.text; for (const p of PLATFORM_IDS) if (s.overrides?.[p]) delete s.overrides[p]![edit.slot]; }
  else { s.overrides ??= {}; s.overrides[edit.platform] ??= {}; if (s.slots[edit.slot] === edit.text) delete s.overrides[edit.platform]![edit.slot]; else s.overrides[edit.platform]![edit.slot] = edit.text; }
  copy.slides[k] = s;
  return rerenderSlide(carouselId, ctx, carousel.language, copy, s);
}

/** Font-size ceilings for one slide so an edited or regenerated slide keeps the carousel's type sizes. */
function capsFromStored(ctx: Ctx, carouselId: number, copy: CopyData, idx: number): Record<string, number> | undefined {
  const stored = getRenderInfo(carouselId), sizes = new Map<number, Record<string, { kind: string; size: number }>>();
  for (const sl of copy.slides) { const i = stored[sl.idx]?.instagram; if (i) sizes.set(sl.idx, Object.fromEntries(Object.entries(i.slots).map(([k, v]) => [k, { kind: v.kind, size: v.size }]))); }
  return sizeCapsFor(ctx, copy.slides, sizes).get(idx);
}
async function rerenderSlide(carouselId: number, ctx: Ctx, lang: Lang, copy: CopyData, s: SlideCopy) {
  const dir = carouselDir(ctx.brand.slug, carouselId);
  const issues = [...validateSlide(s, ctx.spec, ctx.manifest, lang, copy.slides.length, copy.slides), ...(await renderPair(ctx, dir, s, copy.slides.length, capsFromStored(ctx, carouselId, copy, s.idx)).then(async (r) => { upsertSlide(carouselId, s.idx, s.archetype, r.ig, r.li, s.overrides); setRenderInfo(carouselId, s.idx, r.info); return r.issues; }))];
  const flags = { ...(getCarousel(carouselId)!.flags) };
  if (issues.length) flags[String(s.idx)] = flagsFrom(issues)[String(s.idx)]; else delete flags[String(s.idx)];
  saveCopy(carouselId, copy, flags);
  setStatus(carouselId, Object.keys(flags).length ? "needs_review" : "ready");
  await exportAll(carouselId);
  return { issues, flags };
}

const headlineOf = (ctx: Ctx, s?: SlideCopy) => { if (!s) return null; const a = ctx.manifest.archetypes.find((x) => x.id === s.archetype); const sl = a?.slots.find((x) => x.kind === "headline" || x.kind === "number") ?? a?.slots[0]; return sl ? s.slots[sl.name] ?? null : null; };

/** Regenerate ONE slide: one cheap call carrying only the digest, this slide's schema, neighbours' headlines and the instruction. */
export async function regenerateSlide(carouselId: number, idx: number, opts: { instruction?: string; archetype?: string } = {}) {
  const { carousel, ctx } = loadCtxForCarousel(carouselId);
  const copy = carousel.copy!, k = copy.slides.findIndex((s) => s.idx === idx);
  if (k < 0) throw new Error("Slide not found");
  const cur = copy.slides[k], n = copy.slides.length, archetype = opts.archetype ?? cur.archetype;
  if (!ctx.manifest.archetypes.some((a) => a.id === archetype)) throw new Error(`Unknown archetype "${archetype}"`);
  const { system } = await buildSystem(ctx.spec, ctx.manifest, "regen.md");
  const user = [
    `Rewrite slide ${idx} of ${n}. Language: ${LANGUAGES[carousel.language]}. Topic: ${carousel.topic}`,
    `Allowed archetype: ${archetype}. Slots: ${slideSchemaText(ctx.manifest, archetype)}`,
    `Previous slide headline: ${headlineOf(ctx, copy.slides[k - 1]) ?? "(none, this is the first slide)"}`,
    `Next slide headline: ${headlineOf(ctx, copy.slides[k + 1]) ?? "(none, this is the last slide)"}`,
    `Current version of this slide: ${JSON.stringify({ slots: cur.slots, overrides: cur.overrides })}`,
    `Instruction: ${opts.instruction?.trim() || "Write a fresh take on the same point."}`,
  ].join("\n");
  const { data } = await llmCall({ stage: "carousel.regen", tier: "text_strong", system, user, schema: SlideSchema, carouselId, maxOutTokens: 2500, thinking: 1200 });
  const s: SlideCopy = { ...data, idx, archetype };
  copy.slides[k] = s;
  return rerenderSlide(carouselId, ctx, carousel.language, copy, s);
}
export { z };


/** Re-render every slide of a carousel with the CURRENT template kit (same copy). Free: no AI call. */
export async function rerenderCarousel(carouselId: number): Promise<{ flags: Flags }> {
  const { carousel, ctx } = loadCtxForCarousel(carouselId);
  const copy = carousel.copy!, dir = carouselDir(ctx.brand.slug, carouselId), flags: Flags = {};
  const first = new Map<number, Awaited<ReturnType<typeof renderPair>>>(), sizes = new Map<number, Record<string, { kind: string; size: number }>>();
  for (const s of copy.slides) { const r = await renderPair(ctx, dir, s, copy.slides.length); first.set(s.idx, r); const i = r.info.instagram; if (i) sizes.set(s.idx, Object.fromEntries(Object.entries(i.slots).map(([k, v]) => [k, { kind: v.kind, size: v.size }]))); }
  const caps = sizeCapsFor(ctx, copy.slides, sizes);
  for (const s of copy.slides) {
    const r = caps.get(s.idx) ? await renderPair(ctx, dir, s, copy.slides.length, caps.get(s.idx)) : first.get(s.idx)!;
    upsertSlide(carouselId, s.idx, s.archetype, r.ig, r.li, s.overrides); setRenderInfo(carouselId, s.idx, r.info);
    const issues = [...validateSlide(s, ctx.spec, ctx.manifest, carousel.language, copy.slides.length, copy.slides), ...r.issues];
    if (issues.length) flags[String(s.idx)] = flagsFrom(issues)[String(s.idx)];
  }
  saveCopy(carouselId, copy, flags);
  setStatus(carouselId, Object.keys(flags).length ? "needs_review" : "ready");
  await exportAll(carouselId);
  return { flags };
}
