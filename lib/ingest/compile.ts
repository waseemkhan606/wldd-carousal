import fs from "node:fs/promises";
import sharp from "sharp";
import path from "node:path";
import { db } from "../db";
import { getLookbook, getBrand, lookbookDir } from "../db/repo";
import { StyleSpec, renderForVision } from "./spec";
import { generateKit, repairKit, writeKit, validateKitStatic, type KitOutput, type KitManifest } from "./kit";
import { scoreFidelity, sideBySide, downscale } from "./fidelity";
import { extractGeometry, findFrames, pickFrames, describeGeometry, type PageGeometry } from "./geometry";
import { measure, type Metrics } from "./measure";
import { pdfInfo } from "./pdf";
import { findLogoBox, cropLogo, type LogoBox } from "./logo";
import { alignArchetype, sanitizeHex, swapLogo, enforceFurniture, fixContrast, enforceReadable } from "./autoalign";
const W0 = 1080;
import { assertCredits } from "../llm/preflight";
import { editedTemplates } from "./kitlog";
import { polishStamps, enforceClearance, clearStaticText, hygieneExempt, hygieneType, alignRows, symmetricColumn, floorTextSizes, addEdgeBands, harmoniseFurniture, enforceBackdropContrast, liftSlots, dedupeFurniture, nowrapPlaceholders, thickenRuledLines, rulerGrid, usesGrid, ruledLineHeights, snapToRuledGrid, leftAlignStray, anchorLeft, balanceVertical } from "./polish";
import { verticalLines, diffLines, verticalLineOverride, lineOpacity } from "./decor";
import { renderSlide, type RenderDiag } from "../render/renderer";
import { lookbookCost } from "../llm/usage";
import type { Progress } from "./run";

export const TARGET = 85;       // every archetype should reach this measured score
export const MAX_ROUNDS = Number(process.env.KIT_REPAIR_ROUNDS ?? 0);    // measured repair rounds (each is one Pro call)
export type ArchReport = { score: number; metrics: Metrics | null; judge?: number; judgeDiffs?: string[]; source_page?: number };
export type KitReport = { score: number; min: number; perArchetype: Record<string, ArchReport>; renderProblems: Record<string, string[]>; rounds: { round: number; mean: number; min: number; kept: boolean }[]; repairs: string[]; warnings: string[]; costUsd: number };

type Rendered = Record<string, { png: Buffer; diag: RenderDiag; problems: string[] }>;

async function renderSamples(kitDir: string, manifest: KitManifest, spec: StyleSpec): Promise<Rendered> {
  const out: Rendered = {};
  for (const a of manifest.archetypes) {
    const r = await renderSlide({ kitDir, manifest, archetypeId: a.id, slots: a.sample_slots, vars: { idx: 1, total: 5, handle: spec.brand.handle ?? "", brand: spec.brand.name } });
    out[a.id] = { png: r.png, diag: r.diag, problems: r.problems };
  }
  return out;
}
const allProblems = (r: Rendered) => Object.entries(r).flatMap(([id, x]) => x.problems.map((p) => `[${id}] ${p}`));
function clean(kit: KitOutput, spec: StyleSpec): { kit: KitOutput; replaced: number } {
  const r = sanitizeHex(kit.css, kit.archetypes.map((a) => a.html), spec);
  return { kit: { css: r.css, archetypes: kit.archetypes.map((a, i) => { const kinds = Object.fromEntries((spec.archetypes.find((x) => x.id === a.id)?.slots ?? []).map((x) => [x.name, x.kind])); return { ...a, html: polishStamps(r.htmls[i], kinds).html }; }) }, replaced: r.replaced };
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/** Spec -> kit/ on disk: grounded in PDF geometry, validated, then improved by a measured loop. */
export async function compileKit(lookbookId: number, progress: Progress = () => {}, opts: { reuse?: boolean } = {}): Promise<KitReport> {
  const lb = getLookbook(lookbookId)!;
  const brand = getBrand(lb.brand_id)!;
  const dir = lookbookDir(brand.slug, lb.version), kitDir = path.join(dir, "kit");
  const spec = StyleSpec.parse(JSON.parse(lb.spec_json!));
  const fontsCss = await fs.readFile(path.join(dir, "fonts", "fonts.css"), "utf8");
  const repairs: string[] = [], warnings: string[] = [];

  // ---- 1. exact geometry of each sample post (deterministic) ----
  progress("geometry", "Measuring sample posts from the PDF");
  const info = await pdfInfo(lb.source_path);
  const pages = [...new Set(spec.archetypes.map((a) => a.source_page).filter((p): p is number => !!p))].sort((a, b) => a - b);
  const geoBy = new Map<string, PageGeometry>(); // by archetype id: several archetypes can share a page (carousel strips)
  for (const p of pages) {
    try {
      const frames = await findFrames(lb.source_path, p, info);
      const here = spec.archetypes.filter((a) => a.source_page === p);
      const colour = (t: string) => spec.colors.find((c) => c.token === t)?.hex;
      const chosen = pickFrames(frames, here.map((a) => ({ id: a.id, purpose: a.purpose, bg: colour(a.background_token) })));
      for (const a of here) { const f = chosen.get(a.id); if (!f) continue; const g = await extractGeometry(lb.source_path, p, info, f); if (g && g.words.length) geoBy.set(a.id, g); }
    } catch (e: any) { warnings.push(`Geometry extraction failed on page ${p}: ${String(e.message).slice(0, 100)}`); }
  }
  const geoFor = (a: { id: string }) => geoBy.get(a.id);
  for (const a of spec.archetypes) if (!geoFor(a)) warnings.push(`No measurable geometry for "${a.id}" (post location unknown or no text layer): fidelity uses the vision judge only.`);
  // brand mark: crop the real logo from the PDF instead of letting the model redraw it
  let logoNote = "", logoBox: LogoBox | null = null;
  const logoFurn = spec.layout.fixed_furniture.find((f) => /logo|emblem|brand ?mark|icon/i.test(f.what));
  if (logoFurn) {
    const file = path.join(dir, "assets", "logo.png");
    let box: LogoBox | null = (spec.assets.find((a) => a.id === "logo")?.box as LogoBox | undefined) ?? null;
    if (!box || !(await fs.stat(file).then(() => true, () => false))) {
      box = null;
      for (const a of spec.archetypes) {
        const g = geoFor(a); if (!g?.frame) continue;
        const b = await findLogoBox(g, logoFurn.position).catch(() => null); if (!b) continue;
        await cropLogo(lb.source_path, g, g.frame, b, file); box = b;
        spec.assets = [...spec.assets.filter((x) => x.id !== "logo"), { id: "logo", kind: "logo", page: g.page, box: b }]; // box in 1080x1350 slide px
        db().prepare("UPDATE lookbooks SET spec_json=? WHERE id=?").run(JSON.stringify(spec), lookbookId);
        await fs.writeFile(path.join(dir, "spec.json"), JSON.stringify(spec, null, 2));
        break;
      }
    }
    logoBox = box;
    if (box) logoNote = `\n\n## Brand logo asset (measured from the PDF)\nThe real logo has been cropped to ../assets/logo.png (RGBA, transparent background). The furniture item "${logoFurn.what}" MUST be \`<img src="../assets/logo.png" alt="">\` (never redraw or approximate the logo), displayed at about ${box.w}x${box.h}px with its top-left at x=${box.x}, y=${box.y} of the 1080x1350 slide.`;
    else warnings.push("Could not isolate the logo from the PDF; the kit's drawing of it is an approximation.");
  }
  const geometryText = logoNote + spec.archetypes.filter((a) => geoFor(a)).map((a) => `## Reference geometry for archetype "${a.id}" (look book page ${a.source_page})\n${describeGeometry(geoFor(a)!)}`).join("\n\n");

  // ---- 2. generate N candidates concurrently, keep the best by MEASURED score ----
  // Adaptive best-of-N: one candidate first (cheapest); only if its MEASURED score is below the bar do we pay for two more.
  const N = Number(process.env.KIT_CANDIDATES ?? 3), FIRST = process.env.KIT_CANDIDATES ? N : 1, BAR = Number(process.env.KIT_BAR ?? 75);
  progress("kit", FIRST > 1 ? `Generating ${FIRST} candidate kits` : "Generating the templates");
  // dev switch: re-run alignment/decoration/measurement on the stored kit without paying for generation again
  const stored = (opts.reuse || process.env.KIT_REUSE) ? await fs.readFile(path.join(kitDir, "kit.raw.json"), "utf8").catch(() => fs.readFile(path.join(kitDir, "kit.source.json"), "utf8")).then((t) => JSON.parse(t) as KitOutput).catch(() => null) : null; // the model's own output, before any automatic fix
  const gen = (k: number) => Promise.allSettled(Array.from({ length: k }, () => generateKit({ spec, pdf: lb.source_path, visionDir: path.join(dir, "vision"), lookbookId, geometry: geometryText })));
  const pick = (settled: PromiseSettledResult<{ kit: KitOutput; promptVersion: string }>[]) => settled.flatMap((r) => (r.status === "fulfilled" ? [{ kit: clean(r.value.kit, spec).kit, promptVersion: r.value.promptVersion }] : []));
  if (!stored) await assertCredits(Number(process.env.KIT_PREFLIGHT_USD ?? 1.0), "building the templates");
  const settled = stored ? [{ status: "fulfilled" as const, value: { kit: stored, promptVersion: "reused" } }] : await gen(FIRST);
  let cands = pick(settled);
  if (!cands.length) throw new Error(`Kit generation failed: ${(settled[0] as PromiseRejectedResult).reason?.message ?? "unknown error"}`);
  const promptVersion = cands[0].promptVersion;
  const meanScore = (ms: Record<string, Metrics | null>, r: Rendered) => { const v = spec.archetypes.map((a) => (ms[a.id] ? ms[a.id]!.score - Math.min(24, 8 * (r[a.id]?.problems.length ?? 0)) : null)).filter((x): x is number => x !== null); return v.length ? mean(v) : 100; };
  let kit = cands[0].kit, bestScore = -1, bestHasProblems = false;
  const scoreAll = async (list: typeof cands, offset: number) => {
    for (const [i, c] of list.entries()) {
      if (validateKitStatic(c.kit, spec).length) { warnings.push(`Candidate ${offset + i + 1} violated kit constraints and was skipped.`); continue; }
      progress("kit", `Scoring candidate ${offset + i + 1}`);
      const m = await writeKit(kitDir, spec, c.kit, fontsCss, promptVersion);
      const r = await renderSamples(kitDir, m, spec);
      const ms: Record<string, Metrics | null> = {};
      for (const a of spec.archetypes) { const g = geoFor(a); ms[a.id] = g && r[a.id] ? await measure(r[a.id].png, r[a.id].diag, g) : null; }
      const sc = meanScore(ms, r);
      repairs.push(`candidate ${offset + i + 1}: measured mean ${sc.toFixed(1)}`);
      if (sc > bestScore) { bestScore = sc; kit = c.kit; bestHasProblems = Object.values(r).some((x) => x.problems.length > 0); }
    }
  };
  if (!stored) {
    await scoreAll(cands, 0);
    if (bestScore < BAR && N > cands.length) { progress("kit", `First kit scored ${bestScore.toFixed(0)}, below ${BAR}: trying ${N - cands.length} more`); const more = pick(await gen(N - cands.length)); await scoreAll(more, cands.length); cands = [...cands, ...more]; }
  }
  // ---- constraint pass (static rules, render checks): one repair ----
  let manifest!: KitManifest, rendered!: Rendered;
  for (let round = 0; round < 2; round++) {
    const staticIssues = validateKitStatic(kit, spec);
    let issues = staticIssues;
    if (!staticIssues.length) {
      progress("kit", "Rendering sample slides");
      manifest = await writeKit(kitDir, spec, kit, fontsCss, promptVersion);
      rendered = await renderSamples(kitDir, manifest, spec);
      issues = allProblems(rendered);
    }
    if (!issues.length) break;
    if (stored && !staticIssues.length) { warnings.push(...issues); break; } // reuse mode: no paid repair
    if (round === 1) { if (staticIssues.length) throw new Error(`Kit still violates constraints after one repair:\n${staticIssues.join("\n")}`); warnings.push(...issues); break; }
    progress("kit", `Repairing kit (${issues.length} constraint issues)`);
    repairs.push(`constraints: ${issues.length} issues`);
    try { kit = clean(await repairKit({ spec, kit, issues, lookbookId, stage: "ingest.kit_repair", geometry: geometryText }), spec).kit; }
    catch (e: any) { if (staticIssues.length) throw e; warnings.push(`Constraint repair failed (${String(e.message).slice(0, 120)}); kept the unrepaired kit.`); break; }
  }

  // ---- 3. measured loop ----
  const evaluate = async (k: KitOutput, r: Rendered) => {
    const metrics: Record<string, Metrics | null> = {};
    for (const a of spec.archetypes) {
      const g = geoFor(a), x = r[a.id];
      metrics[a.id] = g && x ? await measure(x.png, x.diag, g) : null;
    }
    const scored = Object.values(metrics).filter((m): m is Metrics => !!m);
    const penalty = (id: string) => Math.min(24, 8 * (r[id]?.problems.length ?? 0)); // every unresolved render problem (collision, invisible, overflow) costs points
    const scores = spec.archetypes.map((a) => (metrics[a.id] ? metrics[a.id]!.score - penalty(a.id) : null)).filter((v): v is number => v !== null);
    return { kit: k, rendered: r, metrics, mean: mean(scores), min: scores.length ? Math.min(...scores) : 100, scored: scored.length };
  };
  await fs.writeFile(path.join(kitDir, "kit.raw.json"), JSON.stringify(kit)).catch(() => {}); // what the model built (after the one constraint repair): re-polishing always starts from this, never from an already polished kit
  let best = await evaluate(kit, rendered);
  const rounds: KitReport["rounds"] = [{ round: 0, mean: best.mean, min: best.min, kept: true }];
  // free deterministic solver first: staged cycles (shape, then position), per-archetype acceptance
  const alignLog: string[] = [];
  const ownerEdited = await editedTemplates(kitDir); // templates the owner changed by instruction are not pulled back towards the sample
  const edit = (k: KitOutput, ev: typeof best, mode: "shape" | "move") => { const nk: KitOutput = JSON.parse(JSON.stringify(k)); let n = 0; for (const a of nk.archetypes) { const m = ev.metrics[a.id]; if (!m || !ev.rendered[a.id] || ownerEdited.has(a.id)) continue; const r = alignArchetype(a.html, m, ev.rendered[a.id].diag, spec, mode); a.html = r.html; n += r.changes.length; if (r.changes.length) alignLog.push(`${mode} ${a.id}: ${r.changes.join(", ")}`); } return { nk, n }; };
  const evalKit = async (k: KitOutput) => { const m = await writeKit(kitDir, spec, k, fontsCss, promptVersion); return { m, ev: await evaluate(k, await renderSamples(kitDir, m, spec)) }; };
  // furniture that this archetype's own reference doesn't show is hidden unconditionally (correctness, not a score gamble)
  if (best.scored) {
    const nk: KitOutput = JSON.parse(JSON.stringify(best.kit)); let hid = 0;
    for (const a of nk.archetypes) { const m = best.metrics[a.id]; if (!m || !best.rendered[a.id]) continue; const r = alignArchetype(a.html, m, best.rendered[a.id].diag, spec, "hide"); a.html = r.html; hid += r.changes.length; if (r.changes.length) alignLog.push(`hide ${a.id}: ${r.changes.join(", ")}`); }
    if (hid) { const e = await evalKit(nk); best = e.ev; manifest = e.m; } // correctness fix: not gated on the score
  }
  // written rules beat sample artwork: put furniture on the side its rule states (e.g. "slide count top-right")
  if (best.scored || true) {
    const nk: KitOutput = JSON.parse(JSON.stringify(best.kit)); let moved = 0;
    for (const a of nk.archetypes) { const r = best.rendered[a.id]; if (!r) continue; const o = enforceFurniture(a.html, r.diag, spec); a.html = o.html; moved += o.changes.length; if (o.changes.length) alignLog.push(`furniture ${a.id}: ${o.changes.join(", ")}`); }
    if (moved) { const e = await evalKit(nk); best = e.ev; manifest = e.m; }
  }
  // the real logo goes in deterministically, at the measured position and size (the model's drawing is replaced)
  if (logoBox && logoFurn) {
    const nk: KitOutput = JSON.parse(JSON.stringify(best.kit)); let swapped = 0;
    for (const a of nk.archetypes) { const h2 = swapLogo(a.html, logoFurn.what, logoBox); if (h2 !== a.html) { a.html = h2; swapped++; } }
    if (swapped) { alignLog.push(`logo: real asset placed in ${swapped} archetype(s) at ${logoBox.x},${logoBox.y} ${logoBox.w}x${logoBox.h}`); const e = await evalKit(nk); best = e.ev; manifest = e.m; }
  }
  for (let cycle = 1; cycle <= 4 && best.scored; cycle++) {
    const s1 = edit(best.kit, best, "shape"); const e1 = s1.n ? await evalKit(s1.nk) : { m: manifest, ev: best };
    const s2 = edit(s1.nk, e1.ev, "move"); if (!s1.n && !s2.n) break;
    const e2 = s2.n ? await evalKit(s2.nk) : e1;
    // per-archetype acceptance: keep a corrected template only if its own measured score went up
    const merged: KitOutput = JSON.parse(JSON.stringify(best.kit)); let took = 0;
    for (const a of merged.archetypes) {
      const before = best.metrics[a.id]?.score, after = e2.ev.metrics[a.id]?.score;
      if (before !== undefined && after !== undefined && after > before + 0.5) { a.html = s2.nk.archetypes.find((x) => x.id === a.id)!.html; took++; }
    }
    if (!took) break;
    progress("kit", `Auto-align cycle ${cycle}: ${took} archetype(s) improved`);
    const fin = await evalKit(merged);
    rounds.push({ round: -cycle, mean: fin.ev.mean, min: fin.ev.min, kept: fin.ev.mean > best.mean + 0.2 });
    if (fin.ev.mean > best.mean + 0.2) { best = fin.ev; manifest = fin.m; } else break;
  }
  await fs.writeFile(path.join(kitDir, "autoalign.log"), alignLog.join("\n")).catch(() => {});
  // decoration lines (margin rules, dividers): detect in render vs reference, patch the CSS that draws them, scoped per archetype
  if (best.scored) {
    const overrides: Record<string, string> = {};
    for (const a of spec.archetypes) {
      const g = geoFor(a), r = best.rendered[a.id]; if (!g || !r) continue;
      const bgc = (await sharp(g.referencePng).stats()).dominant, bg = "#" + [bgc.r, bgc.g, bgc.b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
      for (const f of diffLines(await verticalLines(g.referencePng), await verticalLines(r.png))) {
        const o = verticalLineOverride(best.kit.css, f.fromX, f.dx, a.id, lineOpacity(f.ref.color, f.got.color, bg));
        if (o) { overrides[a.id] = (overrides[a.id] ?? "") + o + "\n"; alignLog.push(`decor ${a.id}: vertical line x ${Math.round(f.fromX)}→${Math.round(f.ref.x)}`); }
      }
    }
    const ids = Object.keys(overrides);
    if (ids.length) {
      progress("kit", `Moving decoration lines in ${ids.length} archetype(s)`);
      const withCss = (accepted: string[]): KitOutput => ({ ...best.kit, css: best.kit.css + "\n/* decoration alignment (measured) */\n" + accepted.map((i) => overrides[i]).join("") });
      const trial = await evalKit(withCss(ids));
      const accepted = ids.filter((i) => (trial.ev.metrics[i]?.score ?? 0) > (best.metrics[i]?.score ?? 0) + 0.3);
      if (accepted.length) {
        const fin = await evalKit(withCss(accepted));
        rounds.push({ round: -50, mean: fin.ev.mean, min: fin.ev.min, kept: fin.ev.mean > best.mean });
        if (fin.ev.mean > best.mean) { best = fin.ev; manifest = fin.m; }
      }
    }
  }
  for (let round = 1; round <= MAX_ROUNDS && best.scored && best.min < TARGET; round++) {
    const weak = spec.archetypes.filter((a) => best.metrics[a.id] && best.metrics[a.id]!.score - (best.rendered[a.id].problems.length ? 8 : 0) < TARGET + 5);
    const issues = weak.flatMap((a) => [...best.metrics[a.id]!.issues.slice(0, 8), ...best.rendered[a.id].problems].map((i) => `[${a.id}] (measured score ${best.metrics[a.id]!.score.toFixed(0)}) ${i}`));
    progress("kit", `Measured repair round ${round}: weakest ${best.min.toFixed(0)} < ${TARGET}`);
    repairs.push(`measured round ${round}: min ${best.min.toFixed(0)}, mean ${best.mean.toFixed(0)}`);
    const images = await Promise.all(weak.slice(0, 3).map((a) => sideBySide(best.rendered[a.id].png, geoFor(a)!.referencePng)));
    let cand: KitOutput | null = null;
    try { cand = clean(await repairKit({ spec, kit: best.kit, issues, lookbookId, stage: "ingest.kit_repair", images, geometry: geometryText }), spec).kit; }
    catch (e: any) { warnings.push(`Repair round ${round} failed (${String(e.message).slice(0, 120)}); keeping the best kit so far.`); break; }
    if (validateKitStatic(cand, spec).length) { rounds.push({ round, mean: best.mean, min: best.min, kept: false }); warnings.push(`Repair round ${round} broke kit constraints and was discarded.`); continue; }
    const m2 = await writeKit(kitDir, spec, cand, fontsCss, promptVersion);
    const r2 = await renderSamples(kitDir, m2, spec);
    const ev = await evaluate(cand, r2);
    const better = ev.mean > best.mean + 0.5 && ev.min >= best.min - 2;
    rounds.push({ round, mean: ev.mean, min: ev.min, kept: better });
    if (better) { best = ev; manifest = m2; } else { manifest = await writeKit(kitDir, spec, best.kit, fontsCss, promptVersion); warnings.push(`Repair round ${round} did not improve the measured score (${ev.mean.toFixed(1)} vs ${best.mean.toFixed(1)}); kept the previous kit.`); break; }
  }
  // template polish, always: consistent alignment, stamps fitted, text clear of rule lines and inside the margins, content balanced vertically, paper lines visible
  {
    const kindsOf = (id: string) => Object.fromEntries((spec.archetypes.find((x) => x.id === id)?.slots ?? []).map((x) => [x.name, x.kind]));
    const mgL = (() => { const m = spec.layout.margins_px; return typeof m === "number" ? m : m.left; })();
    const before = best; // safety net: polish is kept per template only if it does not make that template worse
    // phase A: structural fixes that change text flow, then re-render so phase B measures the real result
    const exempt = hygieneExempt(spec); // what the look book itself states about alignment, size and spacing wins over the hygiene defaults
    const A: KitOutput = JSON.parse(JSON.stringify(best.kit)); let na = 0; const stray: Record<string, string[]> = {};
    const eb = addEdgeBands(A.archetypes, A.css, spec); A.css = eb.css; na += eb.changes.length; for (const c of eb.changes) alignLog.push(`coherence ${c}`);
    const hf = harmoniseFurniture(A.archetypes, A.css); na += hf.length; for (const c of hf) alignLog.push(`coherence ${c}`);
    const th = thickenRuledLines(A.css); A.css = th.css; na += th.changed; if (th.changed) alignLog.push(`polish: ${th.changed} ruled-line gradient(s) thickened to 2px`);
    for (const a of A.archetypes) { const r = best.rendered[a.id]; if (!r) continue; if (exempt.align || ownerEdited.has(a.id) || geoFor(spec.archetypes.find((x) => x.id === a.id)!)) continue; /* sampled templates keep their measured alignment; a stated alignment rule is respected */ const o = leftAlignStray(a.html, r.diag, kindsOf(a.id)); a.html = o.html; if (o.slots.length) { stray[a.id] = o.slots; na += o.slots.length; alignLog.push(`polish ${a.id}: left-aligned ${o.slots.join(", ")}`); } }
    { const proxies = A.archetypes.filter((a) => !ownerEdited.has(a.id)).map((a) => ({ id: a.id, html: a.html, isCover: /cover/i.test(a.id) || (!!spec.lookbook?.coverPage && spec.archetypes.find((x) => x.id === a.id)?.source_page === spec.lookbook.coverPage) }));
      const ch = hygieneType(proxies, kindsOf, exempt); proxies.forEach((p) => { A.archetypes.find((x) => x.id === p.id)!.html = p.html; }); na += ch.length; if (ch.length) alignLog.push(`hygiene: ${ch.join("; ")}`); }
    for (const a of A.archetypes) { if (ownerEdited.has(a.id)) continue; const f = floorTextSizes(a.html, kindsOf(a.id)); a.html = f.html; na += f.changes.length; if (f.changes.length) alignLog.push(`polish ${a.id}: ${f.changes.join(', ')}`); }
    const grid = rulerGrid(A.css);
    for (const a of A.archetypes) { const r = best.rendered[a.id]; if (!r || ownerEdited.has(a.id) || !usesGrid(a.html, grid)) continue; const o = ruledLineHeights(a.html, r.diag, kindsOf(a.id), grid); a.html = o.html; if (o.changes.length) { na += o.changes.length; alignLog.push(`coherence ${a.id} (ruled paper ${grid.pitch}px): ${o.changes.join(", ")}`); } }
    if (na) { const e = await evalKit(A); best = e.ev; manifest = e.m; }
    // phase B: positioning on the fresh render
    const nk: KitOutput = JSON.parse(JSON.stringify(best.kit)); let n = 0;
    for (const a of nk.archetypes) {
      const r = best.rendered[a.id]; if (!r) continue;
      const kinds = kindsOf(a.id), rules = await verticalLines(r.png).catch(() => []);
      const ruleX = rules.filter((l) => l.thick <= 10 && l.x > 40 && l.x < W0 / 2).map((l) => l.x + l.thick).sort((x, y) => y - x)[0] ?? 0, left = Math.max(mgL, ruleX ? ruleX + 28 : 0);
      const mine = ownerEdited.has(a.id), skip = () => ({ html: a.html, changes: [] as string[] }); // an instruction edit is final: layout polish never rewrites it
      const o0 = mine ? skip() : anchorLeft(a.html, r.diag, stray[a.id] ?? [], left, kinds); a.html = o0.html;
      const o1 = mine ? skip() : enforceClearance(a.html, r.diag, spec, rules, kinds, stray[a.id] ?? []); a.html = o1.html;
      const o3 = mine ? skip() : clearStaticText(a.html, nk.css, spec, rules); a.html = o3.html;
      const oR = mine ? skip() : alignRows(a.html, r.diag, kinds); a.html = oR.html;
      const oS = !mine && !exempt.align && !geoFor(spec.archetypes.find((x) => x.id === a.id)!) ? symmetricColumn(a.html, r.diag, spec, kinds, left) : { html: a.html, changes: [] as string[] }; a.html = oS.html;
      const o5 = !mine && usesGrid(a.html, grid) ? snapToRuledGrid(a.html, r.diag, kinds, grid) : { html: a.html, changes: [] as string[] }; a.html = o5.html;
      const o4 = mine ? skip() : balanceVertical(a.html, r.diag, spec, kinds, usesGrid(a.html, grid) ? grid.pitch : 0); a.html = o4.html;
      const o2 = polishStamps(a.html, kinds); a.html = o2.html;
      const o6 = dedupeFurniture(a.html, r.diag, kinds); a.html = nowrapPlaceholders(liftSlots(o6.html, kinds));
      const o7 = await enforceBackdropContrast(a.html, r.png, r.diag, spec, kinds); a.html = o7.html;
      const all = [...oR.changes, ...oS.changes, ...o0.changes, ...o1.changes, ...o3.changes, ...o5.changes, ...o4.changes, ...o2.changes, ...o6.changes, ...o7.changes]; n += all.length; if (all.length) alignLog.push(`polish ${a.id}: ${all.join(", ")}`);
    }
    if (n) {
      let e = await evalKit(nk); best = e.ev; manifest = e.m;
      // coherence safety net: a template that got worse (new render problems, or a clearly lower measured score) keeps its pre-polish version
      const reverted: string[] = [];
      for (const a of nk.archetypes) {
        const b0 = before.rendered[a.id], b1 = best.rendered[a.id]; if (!b0 || !b1) continue;
        const worseProblems = b1.problems.length > b0.problems.length, s0 = before.metrics[a.id]?.score, s1 = best.metrics[a.id]?.score, worseScore = false; // similarity to the sample is not a reason to undo a fix: only new render problems are
        if (worseProblems || worseScore) { const old = before.kit.archetypes.find((x) => x.id === a.id); if (old) { a.html = nowrapPlaceholders(liftSlots(old.html, kindsOf(a.id))); { const kf = await enforceBackdropContrast(a.html, b0.png, b0.diag, spec, kindsOf(a.id)); a.html = kf.html; } reverted.push(`${a.id} (${worseProblems ? "new render problems" : "score " + Math.round(s0!) + "→" + Math.round(s1!)})`); } }
      }
      if (reverted.length) { alignLog.push(`coherence: reverted polish for ${reverted.join(", ")}`); e = await evalKit(nk); best = e.ev; manifest = e.m; }
    }
  }
  await fs.writeFile(path.join(kitDir, "autoalign.log"), alignLog.join("\n")).catch(() => {});
  kit = best.kit; rendered = best.rendered;
  manifest = await writeKit(kitDir, spec, kit, fontsCss, promptVersion); // ensure disk == best

  // ---- 4. vision judge: informational, and the only signal for posts we can't measure ----
  const per: Record<string, ArchReport> = {};
  for (const a of spec.archetypes) {
    if (!rendered[a.id]) continue;
    const m = best.metrics[a.id];
    per[a.id] = { score: m ? m.score - (rendered[a.id].problems.length ? 8 : 0) : NaN, metrics: m, source_page: a.source_page };
    const g = geoFor(a);
    let ref: Buffer | undefined = g?.referencePng;
    if (!ref && a.source_page) ref = (await renderForVision(lb.source_path, [a.source_page], path.join(dir, "vision")))[0];
    if (ref) {
      progress("fidelity", `Judging ${a.id}`);
      try {
        const j = await scoreFidelity({ rendered: rendered[a.id].png, reference: ref, archetypeId: a.id, lookbookId });
        per[a.id].judge = j.score; per[a.id].judgeDiffs = j.diffs.map((d) => `${d.area}: ${d.issue}`);
        if (!m) per[a.id].score = j.score;
      } catch (e: any) {
        // the judge is informational: an unavailable provider must never fail an ingest that already succeeded
        if (!warnings.some((w) => w.startsWith("Vision judge unavailable"))) warnings.push(`Vision judge unavailable (${String(e.message).slice(0, 110)}); fidelity uses the measured score only.`);
      }
    }
  }
  await fs.mkdir(path.join(kitDir, "previews"), { recursive: true });
  await fs.mkdir(path.join(kitDir, "compare"), { recursive: true });
  for (const [id, r] of Object.entries(rendered)) {
    await fs.writeFile(path.join(kitDir, "previews", `${id}.png`), r.png);
    const a = spec.archetypes.find((x) => x.id === id)!, g = geoFor(a);
    if (g) await fs.writeFile(path.join(kitDir, "compare", `${id}.png`), await sideBySide(r.png, g.referencePng, 1000));
  }
  const vals = Object.values(per).map((p) => p.score).filter((v) => Number.isFinite(v));
  const cost = lookbookCost(lookbookId);
  const report: KitReport = { score: mean(vals), min: vals.length ? Math.min(...vals) : 0, perArchetype: per, renderProblems: Object.fromEntries(Object.entries(rendered).map(([k, v]) => [k, v.problems])), rounds, repairs, warnings, costUsd: cost.usd };
  await fs.writeFile(path.join(kitDir, "report.json"), JSON.stringify(report, null, 1));
  db().prepare("UPDATE lookbooks SET kit_path=?, fidelity_score=?, ingest_cost_json=?, status='ready' WHERE id=?").run(kitDir, Math.round(report.score), JSON.stringify(cost), lookbookId);
  progress("done", `Kit ready: measured fidelity mean ${report.score.toFixed(0)}, weakest ${report.min.toFixed(0)}`);
  return report;
}
