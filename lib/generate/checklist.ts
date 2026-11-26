// The adherence checklist: every guideline in the look book register, evaluated against what was actually produced.
//  code      = checked by code on the copy / rendered slides / pixels / captions
//  template  = verified in the template kit (the design is built into it)
//  ai        = reviewed by a model after generation (tone, "one idea per slide", ...); marked stale after edits
//  info      = context from the look book, nothing to check
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { getCarousel, getRenderInfo, listSlides, saveReview, setRenderInfo, carouselDir, type CarouselRow, type RenderInfo, type ReviewCache, type SlideCopy } from "../db/carousels";
import { ensureGuidelines, furnitureName } from "../ingest/guidelines";
import type { Guideline, StyleSpec } from "../ingest/spec";
import type { KitManifest } from "../ingest/kit";
import { loadCtx, type Ctx } from "./ctx";
import { plain, slotsFor, words } from "./validate";
import { PLATFORM_IDS, LANGUAGES, type PlatformId } from "./platforms";
import { renderSlide } from "../render/renderer";
import { llmCall } from "../llm/router";
import { loadPrompt } from "../ingest/spec";
import { carouselOnly } from "./plan";
import { contrastRatio } from "../ingest/autoalign";

export type Status = "pass" | "fail" | "pending" | "info" | "na";
export type CheckItem = {
  id: string; section: string; page: number; quote: string; statement: string; category: Guideline["category"]; scope: Guideline["scope"];
  method: Guideline["method"]; by: "code" | "template" | "ai" | "info"; status: Status; evidence: string; slides: number[]; fix?: string; stale?: boolean;
};
export type Checklist = { items: CheckItem[]; summary: { total: number; pass: number; fail: number; pending: number; info: number; na: number; followed: number; applicable: number }; reviewedAt?: string; stale: boolean };

type R = { status: Status; evidence: string; slides?: number[]; fix?: string };
const hexOf = (css: string) => { const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : ""; };
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]); };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const list = (n: number[]) => (n.length === 1 ? `slide ${n[0]}` : `slides ${n.join(", ")}`);
const stem = (w: string) => w.replace(/ies$/, "y").replace(/(ss|zz|x|ch|sh)es$/, "$1").replace(/([^s])s$/, "$1");
const stems = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map(stem);
const BG_ROLE = /\b(posts?|bg|backgrounds?|pages?|slides?)\b/i;
const firstFamily = (ff: string) => (ff.split(",")[0] ?? "").replace(/["']/g, "").trim();

const KIND_WORDS: [RegExp, string[]][] = [[/headline|title/i, ["headline"]], [/number|figure/i, ["number"]], [/\bbody\b|copy|paragraph|running text/i, ["body", "list"]], [/\btags?\b|label|counter/i, ["tag"]], [/stamp|seal|sticker/i, ["stamp_text"]], [/\bcta\b|button/i, ["cta"]], [/maths?|command|code|equation|mono/i, ["code", "mono"]]];
const kindsOf = (roles: string[]) => [...new Set(roles.flatMap((r) => KIND_WORDS.filter(([re]) => re.test(r)).flatMap(([, k]) => k)))];
const slotMatches = (name: string, kind: string, kinds: string[]) => !/option|choice|answer|footer/i.test(name) && kinds.includes(kind) || (kinds.includes("code") && /math|command|code|equation/i.test(name));

type Env = {
  c: CarouselRow; ctx: Ctx; spec: StyleSpec; manifest: KitManifest; slides: SlideCopy[]; n: number; lang: string;
  info: Record<number, Partial<Record<PlatformId, RenderInfo>>>; dir: string;
  html: (archetype: string) => string; css: string;
  arch: (id: string) => KitManifest["archetypes"][number] | undefined;
  bgHex: (s: SlideCopy) => string; tokenHex: (token: string) => string;
  png: (idx: number, p: PlatformId) => string;
};

const roleSlides = (position: string, n: number) => (position === "first" ? [1] : position === "last" ? [n] : Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 2));
const slotsOf = (e: Env, s: SlideCopy, p: PlatformId = "instagram") => { const a = e.arch(s.archetype), v = slotsFor(s, p); return (a?.slots ?? []).map((sl) => ({ ...sl, text: v[sl.name] ?? "" })); };

async function checkPalette(e: Env, colours: { name: string; hex: string }[]): Promise<R> {
  const pal = colours.map((c) => c.hex), bad: { slide: number; hex: string; share: number }[] = [];
  const nearBlend = (c: string) => pal.some((a) => pal.some((b) => { const A = rgb(a), B = rgb(b), P = rgb(c); const d = B.map((v, i) => v - A[i]), t = Math.max(0, Math.min(1, d.reduce((s, v, i) => s + v * (P[i] - A[i]), 0) / (d.reduce((s, v) => s + v * v, 0) || 1))); return A.reduce((s, v, i) => s + Math.abs(v + d[i] * t - P[i]), 0) < 48; }));
  for (const s of e.slides) {
    const { data, info } = await sharp(e.png(s.idx, "instagram")).removeAlpha().resize(270, 338).raw().toBuffer({ resolveWithObject: true });
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < info.width * info.height; i++) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2], k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), x = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }; x.n++; x.r += r; x.g += g; x.b += b; bins.set(k, x); }
    for (const x of bins.values()) { const share = x.n / (info.width * info.height); if (share < 0.012) continue; const hx = "#" + [x.r, x.g, x.b].map((v) => Math.round(v / x.n).toString(16).padStart(2, "0")).join("").toUpperCase(); if (!nearBlend(hx) && !pal.some((p) => dist(p, hx) < 60)) bad.push({ slide: s.idx, hex: hx, share }); }
  }
  return bad.length ? { status: "fail", evidence: `Off-palette colour ${bad[0].hex} covers ${(bad[0].share * 100).toFixed(0)}% of slide ${bad[0].slide}${bad.length > 1 ? ` (+${bad.length - 1} more)` : ""}`, slides: [...new Set(bad.map((b) => b.slide))] } : { status: "pass", evidence: `All large colour areas on ${e.slides.length} slides are brand colours` };
}

async function evalGuideline(g: Guideline, e: Env): Promise<R> {
  const P = (g.check?.params ?? {}) as any, n = e.n;
  switch (g.check?.type) {
    case "slide_size": {
      const bad: number[] = [];
      for (const s of e.slides) for (const p of PLATFORM_IDS) { const m = await sharp(e.png(s.idx, p)).metadata(); if (m.width !== P.w || m.height !== P.h) bad.push(s.idx); }
      return bad.length ? { status: "fail", evidence: `${list([...new Set(bad)])} not ${P.w}×${P.h}`, slides: [...new Set(bad)] } : { status: "pass", evidence: `All ${n * 2} images (Instagram + LinkedIn) are ${P.w}×${P.h}` };
    }
    case "max_words_per_slide": {
      const over: { idx: number; w: number }[] = []; let top = 0;
      for (const s of e.slides) for (const p of PLATFORM_IDS) { const w = slotsOf(e, s, p).filter((x) => x.kind !== "tag" || true).reduce((t, x) => t + words(x.text).length, 0); top = Math.max(top, w); if (w > P.max) over.push({ idx: s.idx, w }); }
      const idxs = [...new Set(over.map((o) => o.idx))];
      return idxs.length ? { status: "fail", evidence: `${list(idxs)}: up to ${Math.max(...over.map((o) => o.w))} words, limit ${P.max}`, slides: idxs, fix: "Shorten the text on those slides" } : { status: "pass", evidence: `Longest slide has ${top} words (limit ${P.max})` };
    }
    case "max_elements_per_slide": {
      const kind = /stamp|seal|sticker/i.test(P.kind) ? "stamp_text" : P.kind, over: number[] = [];
      for (const s of e.slides) if (slotsOf(e, s).filter((x) => x.kind === kind && x.text.trim()).length > P.max) over.push(s.idx);
      return over.length ? { status: "fail", evidence: `${list(over)} has more than ${P.max} ${P.kind}`, slides: over } : { status: "pass", evidence: `No slide has more than ${P.max} ${P.kind}` };
    }
    case "slide_role": {
      const hasBg = (P.requires ?? []).some((q: any) => q.kind === "background"), targets = hasBg && P.position === "middle" ? Array.from({ length: Math.max(0, Number(P.to) - Number(P.from) + 1) }, (_, i) => Number(P.from) + i).filter((x) => x >= 1 && x < n) : roleSlides(P.position, n), reqs = (P.requires ?? []) as { kind: string; text?: string }[], fails: string[] = [], notes: string[] = [];
      if (!reqs.length) return { status: "pending", evidence: "Needs AI review" };
      for (const idx of targets) {
        const s = e.slides.find((x) => x.idx === idx); if (!s) continue; const slots = slotsOf(e, s);
        for (const r of reqs) {
          if (r.kind === "background" && (r as any).hex) { const bg = e.bgHex(s); if (bg && dist(bg, (r as any).hex) > 40) fails.push(`slide ${idx} is not on ${r.text}`); else notes.push(`slide ${idx} on ${r.text}`); }
          if (r.kind === "question") { const h = slots.find((x) => x.kind === "headline") ?? slots.find((x) => x.kind !== "tag"); if (!h || !/[?？]/.test(h.text)) fails.push(`slide ${idx} headline isn't a question`); else notes.push(`slide ${idx}: “${plain(h.text)}”`); }
          if (r.kind === "stamp") { const st = slots.find((x) => x.kind === "stamp_text"); if (!st) fails.push(`slide ${idx}'s template has no stamp`); else if (!st.text.trim()) fails.push(`slide ${idx} has no stamp text`); else notes.push(`slide ${idx} stamp “${plain(st.text)}”`); }
          if (r.kind === "phrase") { const st = slots.find((x) => x.kind === "stamp_text"); if (st?.text.trim() && e.lang === "en" && !plain(st.text).toLowerCase().includes((r.text ?? "").toLowerCase())) fails.push(`slide ${idx} stamp should say “${r.text}”`); }
        }
      }
      return fails.length ? { status: "fail", evidence: fails.join("; "), slides: targets, fix: "Edit the slide's text to meet this" } : { status: "pass", evidence: notes.slice(0, 2).join(" · ") || "Requirements met", slides: targets };
    }
    case "alternate_background": {
      const [x, y] = P.colours as { hex: string }[], mid = e.slides.filter((s) => s.idx > 1 && s.idx < n), seq = mid.map((s) => e.bgHex(s));
      if (mid.length < 2) return { status: "na", evidence: "Fewer than two inside slides" };
      const bad = mid.filter((s, i) => (dist(seq[i], x.hex) > 40 && dist(seq[i], y.hex) > 40) || (i > 0 && dist(seq[i], seq[i - 1]) < 30));
      const names = seq.map((h) => (dist(h, x.hex) < 40 ? "A" : dist(h, y.hex) < 40 ? "B" : "?")).join(" ");
      return bad.length ? { status: "fail", evidence: `Inside slides ${mid[0].idx}–${mid[mid.length - 1].idx} don't alternate (${names})`, slides: bad.map((s) => s.idx) } : { status: "pass", evidence: `Slides ${mid[0].idx}–${mid[mid.length - 1].idx} alternate (${names.replace(/A/g, (P.colours[0].name as string).split(" ").pop()!.toLowerCase()).replace(/B/g, (P.colours[1].name as string).split(" ").pop()!.toLowerCase())})` };
    }
    case "color_only_on": {
      const bad: number[] = []; let seen = 0;
      for (const s of e.slides) for (const p of PLATFORM_IDS) { const inf = e.info[s.idx]?.[p]; if (!inf) continue; const bg = e.bgHex(s); for (const sl of Object.values(inf.slots)) if ((P.element === "any" || sl.kind === P.element) && sl.color && dist(hexOf(sl.color), P.accent.hex) < 50) { seen++; if (dist(bg, P.on.hex) > 60) bad.push(s.idx); } }
      return bad.length ? { status: "fail", evidence: `${P.accent.name.toLowerCase()} ${P.element === "any" ? "text" : P.element + "s"} appear on ${list([...new Set(bad)])}, not on ${P.on.name.toLowerCase()}`, slides: [...new Set(bad)] } : seen ? { status: "pass", evidence: `${P.accent.name.toLowerCase()} used only on ${P.on.name.toLowerCase()} (${seen} place${seen > 1 ? "s" : ""})` } : { status: "pass", evidence: `${P.accent.name.toLowerCase()} not used in this carousel` };
    }
    case "caption_sources": {
      const note = (e.c.copy?.sources_note ?? "").trim(), caps = PLATFORM_IDS.map((p) => e.c.copy?.captions[p]?.text ?? "").join(" ");
      return note || /sources?|assum|illustrat|approx|based on/i.test(caps) ? { status: "pass", evidence: note ? `Sources/assumptions are added to both captions: “${note.slice(0, 70)}${note.length > 70 ? "…" : ""}”` : "Captions cite sources" } : { status: "fail", evidence: "No sources or assumptions were provided for the captions", fix: "Regenerate, or add a note to the caption" };
    }
    case "furniture_present": {
      const missing: number[] = [];
      for (const s of e.slides) for (const p of PLATFORM_IDS) { const inf = e.info[s.idx]?.[p]; if (!inf) continue; const hit = inf.furniture.find((f) => furnitureName(f) === P.what || norm(f).includes(norm(P.what))); if (!hit || inf.furnitureMisplaced.some((m) => m.toLowerCase().includes(String(hit).toLowerCase()))) missing.push(s.idx); }
      const idx = [...new Set(missing)];
      return idx.length ? { status: "fail", evidence: `${P.what} missing or misplaced on ${list(idx)}`, slides: idx } : { status: "pass", evidence: `${P.what} ${P.position.replace("-", " ")} on all ${n} slides` };
    }
    case "palette_only": return checkPalette(e, P.colours);
    case "fonts_by_role": {
      const kinds = kindsOf(P.roles ?? []), bad: string[] = []; let seen = 0;
      for (const s of e.slides) for (const p of PLATFORM_IDS) { const inf = e.info[s.idx]?.[p]; if (!inf) continue; for (const [name, sl] of Object.entries(inf.slots)) if (slotMatches(name, sl.kind, kinds) && (slotsFor(s, p)[name] ?? "").trim()) { seen++; if (norm(firstFamily(sl.ff)) !== norm(P.family)) bad.push(`slide ${s.idx} ${name} uses ${firstFamily(sl.ff) || "?"}`); } }
      if (!kinds.length) return { status: "info", evidence: `Roles: ${(P.roles ?? []).join(", ")}` };
      return bad.length ? { status: "fail", evidence: bad.slice(0, 2).join("; "), slides: [...new Set(bad.map((b) => +/slide (\d+)/.exec(b)![1]))] } : seen ? { status: "pass", evidence: `${P.family} on every ${(P.roles as string[]).join("/").toLowerCase()} text (${seen} checked)` } : { status: "na", evidence: "No such text in this carousel" };
    }
    case "colour_usage": {
      const roles = (P.roles ?? []) as string[], textRoles = roles.filter((r) => !BG_ROLE.test(r)), bgRoles = roles.filter((r) => BG_ROLE.test(r)), kinds = kindsOf(textRoles);
      const parts: string[] = []; let failed = "", passedAny = false, seenAny = false;
      if (kinds.length) {
        const ok: number[] = []; let seen = 0;
        for (const s of e.slides) { const inf = e.info[s.idx]?.instagram; if (!inf) continue; for (const [name, sl] of Object.entries(inf.slots)) if (slotMatches(name, sl.kind, kinds) && (slotsFor(s, "instagram")[name] ?? "").trim() && !(e.bgHex(s) && contrastRatio(P.hex, e.bgHex(s)) < 2)) { seen++; const sbg = e.bgHex(s), byFill = sl.kind === "stamp_text" && ((sl.bg && dist(hexOf(sl.bg), P.hex) < 48 && dist(hexOf(sl.bg), sbg) > 30) || (sl.bd && dist(hexOf(sl.bd), P.hex) < 48)); if ((sl.color && dist(hexOf(sl.color), P.hex) < 48) || byFill) ok.push(s.idx); } }
        if (seen) { seenAny = true; if (ok.length) { passedAny = true; parts.push(`${textRoles.filter((r) => kindsOf([r]).length).join(", ").toLowerCase()} on ${list([...new Set(ok)])}`); } else failed = `${P.name.toLowerCase()} is never used for ${textRoles.join(", ").toLowerCase()}`; }
      }
      if (bgRoles.length) {
        const on = e.slides.filter((s) => dist(e.bgHex(s), P.hex) < 40).map((s) => s.idx);
        seenAny = true; if (on.length) { passedAny = true; parts.push(`background of ${list(on)}`); } else if (!kinds.length) return { status: "na", evidence: `Not the background of any slide in this carousel (${bgRoles.join(", ").toLowerCase()})` };
      }
      if (!kinds.length && !bgRoles.length) return { status: "info", evidence: "Covered by the palette check" };
      return failed && !passedAny ? { status: "fail", evidence: failed } : passedAny ? { status: "pass", evidence: `Used for ${parts.join("; ")}` } : seenAny ? { status: "na", evidence: "No such elements in this carousel" } : { status: "na", evidence: "No such elements in this carousel" };
    }
    case "element_present": {
      const w = norm(String(P.name)).slice(0, 5), used = [...new Set(e.slides.map((s) => s.archetype))], htmls = used.map((u) => e.html(u)).join(" ") + e.css;
      const el = e.spec.elements.find((x) => stems(`${x.id} ${x.kind} ${x.description}`).some((t) => stems(String(P.name)).includes(t) && t.length > 3));
      if (!el) return { status: "na", evidence: "No matching element in the template kit" };
      const inUse = used.filter((u) => new RegExp(`el-${el.id}|${el.id}`, "i").test(e.html(u)) || new RegExp(`\\.${el.id}\\b|el-${el.id}`).test(e.css) && e.html(u).toLowerCase().includes(el.id.toLowerCase()));
      void w; void htmls;
      if (P.rotation !== undefined && !new RegExp(`rotate\\(\\s*${P.rotation}deg`).test(e.css) && el.rotation_deg !== P.rotation) return { status: "fail", evidence: `Template doesn't apply the ${P.rotation}° tilt` };
      return inUse.length ? { status: "pass", evidence: `Built into the template (${el.id}${P.rotation !== undefined ? `, ${P.rotation}°` : ""}); used on ${list(e.slides.filter((s) => inUse.includes(s.archetype)).map((s) => s.idx))}` } : { status: "na", evidence: "This element isn't used by the templates chosen for this carousel" };
    }
    case "logo_asset": {
      const used = [...new Set(e.slides.map((s) => s.archetype))], bad = used.filter((u) => !e.html(u).includes("../assets/logo.png"));
      return bad.length ? { status: "fail", evidence: `${bad.join(", ")} draws its own logo instead of the real one` } : { status: "pass", evidence: "The real logo from your PDF is placed unmodified on every template used" };
    }
    case "forbid_visual": {
      const used = [...new Set(e.slides.map((s) => s.archetype))], bad = used.filter((u) => { const h = e.html(u).replace(/<img[^>]*logo\.png[^>]*>/g, ""); return /<img\b|url\(\s*['"]?(?!data:image\/svg)/i.test(h); });
      return bad.length ? { status: "fail", evidence: `${bad.join(", ")} contains an image` } : { status: "pass", evidence: "Templates contain only type, shapes and the logo: no photos or people" };
    }
    case "pillar_background": {
      const st = norm(stem(String(P.stem))).slice(0, 4), a = e.manifest.archetypes.find((x) => norm(x.id).includes(st) || norm(e.spec.archetypes.find((y) => y.id === x.id)?.purpose ?? "").includes(st));
      if (!a) return { status: "na", evidence: `No "${P.stem}" template` };
      const hex = e.tokenHex(a.background_token);
      return dist(hex, P.colour.hex) < 40 ? { status: "pass", evidence: `${a.id} sits on ${P.colour.name.toLowerCase()}` } : { status: "fail", evidence: `${a.id} uses ${hex}, not ${P.colour.name.toLowerCase()}` };
    }
    case "show_the_maths": {
      const all = e.slides.flatMap((s) => slotsOf(e, s).map((x) => x.text)).join("\n"), hasFigure = /[₹$€£]\s?\d|\d\s?%/.test(all), eq = /\d[\d,.]*\s*[×x*÷/+\-−]\s*[\d,.]+\s*=\s*[₹$€£]?\s*[\d,.]+/.test(all);
      return !hasFigure ? { status: "na", evidence: "No figures to work through" } : eq ? { status: "pass", evidence: `Shows the working: “${(/\d[\d,.]*\s*[×x*÷/+\-−]\s*[\d,.]+\s*=\s*[₹$€£]?\s*[\d,.]+/.exec(all) ?? [""])[0]}”` } : { status: "pending", evidence: "Figures appear but no explicit calculation was detected: needs AI review" };
    }
    case "forbid_text": {
      const re = /emoji/i.test(P.pattern) ? /\p{Extended_Pictographic}/u : new RegExp(P.pattern, "iu");
      const hits = e.slides.filter((s) => slotsOf(e, s).some((x) => re.test(plain(x.text))));
      return hits.length ? { status: "fail", evidence: `Found in ${list(hits.map((s) => s.idx))}`, slides: hits.map((s) => s.idx) } : { status: "pass", evidence: "None found on the slides" };
    }
    case "permission": return { status: "info", evidence: e.lang === "hinglish" ? "This carousel is Hinglish: allowed" : "Not applicable to this language" };
    case "format": return { status: "info", evidence: e.c.copy?.format && norm(e.c.copy.format) === norm(P.name) ? "Chosen for this carousel" : "" };
    default: return { status: g.method === "info" ? "info" : "pending", evidence: g.method === "info" ? "" : "Needs AI review" };
  }
}

async function loadEnv(carouselId: number): Promise<Env> {
  const c = getCarousel(carouselId)!, ctx = loadCtx(c.lookbook_id), spec = ctx.spec, dir = carouselDir(ctx.brand.slug, carouselId);
  const slides = c.copy!.slides, rows = listSlides(carouselId);
  let info = getRenderInfo(carouselId);
  if (slides.some((s) => !info[s.idx] || Object.values(info[s.idx].instagram?.slots ?? {}).some((x) => x.bg === undefined))) { // older carousels: re-render once (no cost) to learn the computed fonts/colours
    for (const s of slides) {
      const kinds = Object.fromEntries((ctx.manifest.archetypes.find((a) => a.id === s.archetype)?.slots ?? []).map((x) => [x.name, x.kind])), out: Partial<Record<PlatformId, RenderInfo>> = {};
      for (const p of PLATFORM_IDS) { const r = await renderSlide({ kitDir: ctx.kitDir, manifest: ctx.manifest, archetypeId: s.archetype, slots: slotsFor(s, p), polish: true, vars: { idx: s.idx, total: slides.length, handle: (p === "linkedin" ? spec.brand.linkedin_handle ?? spec.brand.handle : spec.brand.handle) ?? "", brand: spec.brand.name } }); out[p] = { slots: Object.fromEntries(Object.entries(r.diag.slots).map(([k, x]) => [k, { kind: kinds[k] ?? "", ff: x.ff ?? "", color: x.color ?? "", size: x.size, bg: x.bg ?? "", bd: x.bd ?? "" }])), furniture: r.diag.furniture, furnitureMisplaced: r.diag.furnitureMisplaced, collisions: r.diag.collisions, rootBg: r.diag.rootBg ?? "" }; }
      setRenderInfo(carouselId, s.idx, out); info[s.idx] = out;
    }
  }
  const htmlCache = new Map<string, string>();
  const css = await fs.readFile(path.join(ctx.kitDir, "kit.css"), "utf8");
  for (const a of ctx.manifest.archetypes) htmlCache.set(a.id, await fs.readFile(path.join(ctx.kitDir, a.file), "utf8"));
  const tokenHex = (t: string) => spec.colors.find((x) => x.token === t)?.hex ?? "#000000";
  return {
    c, ctx, spec, manifest: ctx.manifest, slides, n: slides.length, lang: c.language, info, dir, css,
    html: (id) => htmlCache.get(id) ?? "", arch: (id) => ctx.manifest.archetypes.find((a) => a.id === id), tokenHex,
    bgHex: (s) => hexOf(info[s.idx]?.instagram?.rootBg ?? "") || tokenHex(ctx.manifest.archetypes.find((a) => a.id === s.archetype)?.background_token ?? ""),
    png: (idx, p) => path.join(dir, rows.find((r) => r.idx === idx)![p === "instagram" ? "png_ig" : "png_li"]!),
  };
}

export const copyHash = (c: CarouselRow) => crypto.createHash("sha1").update(JSON.stringify([c.copy?.slides.map((s) => [s.archetype, s.slots, s.overrides]), c.copy?.captions, c.copy?.sources_note])).digest("hex").slice(0, 12);

/** A quiz post builds curiosity: giving away the answer defeats it. Added to the AI review for any post whose template has answer options. */
const QUIZ_GUIDELINE: Guideline = { id: "q-quiz-no-reveal", section: "Quiz post", page: 0, quote: "", statement: "The slide and the captions do not reveal the correct answer", category: "content", scope: "slide", method: "review", enabled: true };
const isQuiz = (e: { manifest: KitManifest; slides: SlideCopy[] }) => e.slides.length === 1 && (e.manifest.archetypes.find((a) => a.id === e.slides[0].archetype)?.slots.filter((s) => /option|choice|answer/i.test(s.name)).length ?? 0) >= 3;

export async function evaluateChecklist(carouselId: number): Promise<Checklist> {
  const c0 = getCarousel(carouselId); if (!c0?.copy) throw new Error("Carousel not found");
  await ensureGuidelines(c0.lookbook_id);
  const e = await loadEnv(carouselId), stale = !!e.c.review && e.c.review.hash !== copyHash(e.c);
  const items: CheckItem[] = [];
  const isSingle = e.spec.formats.some((f) => f.id === e.c.copy?.format && f.kind === "single");
  for (const g of [...e.spec.guidelines.filter((x) => x.enabled), ...(isQuiz(e) ? [QUIZ_GUIDELINE] : [])]) {
    if (isSingle && carouselOnly(g)) { items.push({ id: g.id, section: g.section, page: g.page, quote: g.quote, statement: g.statement, category: g.category, scope: g.scope, method: g.method, by: "info", status: "na", evidence: "Applies to carousels, not to a single post", slides: [] }); continue; }
    let r: R, by: CheckItem["by"] = g.method === "review" ? "ai" : g.method === "template" ? "template" : g.method === "info" ? "info" : "code";
    if (g.method === "review") {
      const rv = e.c.review?.results[g.id];
      r = rv ? { status: rv.status === "unclear" ? "pending" : rv.status, evidence: rv.evidence, slides: rv.slides, fix: rv.fix } : { status: "pending", evidence: "Not reviewed yet" };
    } else { try { r = await evalGuideline(g, e); } catch (err: any) { r = { status: "pending", evidence: `Could not check: ${String(err.message).slice(0, 80)}` }; } if (g.check?.type === "slide_role" && r.status === "pending") by = "ai"; if (g.check?.type === "show_the_maths" && r.status === "pending") by = "ai"; }
    // a code check that can't decide falls back to the AI review result for the same guideline, if any
    if (r.status === "pending" && e.c.review?.results[g.id]) { const rv = e.c.review.results[g.id]; r = { status: rv.status === "unclear" ? "pending" : rv.status, evidence: rv.evidence, slides: rv.slides, fix: rv.fix }; by = "ai"; }
    items.push({ id: g.id, section: g.section, page: g.page, quote: g.quote, statement: g.statement, category: g.category, scope: g.scope, method: g.method, by, status: r.status, evidence: r.evidence, slides: r.slides ?? [], fix: r.fix, stale: by === "ai" && stale && r.status !== "pending" ? true : undefined });
  }
  // built-in quality gate (not from the look book): every piece of text must be readable on its slide background
  {
    const bad: { slide: number; name: string; ratio: number }[] = []; let seen = 0;
    for (const sl of e.slides) { const inf = e.info[sl.idx]?.instagram; if (!inf) continue; const bg = e.bgHex(sl);
      for (const [name, x] of Object.entries(inf.slots)) { if (!(slotsFor(sl, "instagram")[name] ?? "").trim() || !x.color || !bg) continue; seen++; const solid = x.bg && !/transparent|, 0\)/.test(x.bg) ? hexOf(x.bg) : bg; const r = contrastRatio(hexOf(x.color), solid || bg); if (r < (x.kind === "stamp_text" ? 1.5 : 3)) bad.push({ slide: sl.idx, name, ratio: r }); } }
    items.push({ id: "q-readable", section: "Quality check", page: 0, quote: "", statement: "All text is readable on its background", category: "design", scope: "carousel", method: "code", by: "code", status: bad.length ? "fail" : seen ? "pass" : "na", evidence: bad.length ? bad.slice(0, 3).map((b) => `slide ${b.slide} ${b.name}: contrast ${b.ratio.toFixed(1)}:1`).join("; ") : `${seen} text elements, all at least 3:1`, slides: [...new Set(bad.map((b) => b.slide))], fix: bad.length ? "Edit the slide's colour override or regenerate it." : undefined });
  }
  const count = (s: Status) => items.filter((i) => i.status === s).length, pass = count("pass"), fail = count("fail"), pending = count("pending");
  return { items, summary: { total: items.length, pass, fail, pending, info: count("info"), na: count("na"), followed: pass, applicable: pass + fail + pending }, reviewedAt: e.c.review?.at, stale };
}

// ---- AI review of the guidelines code can't decide (tone, "one idea per slide", ...) ----
const Review = z.object({ results: z.array(z.object({ id: z.string(), status: z.enum(["pass", "fail", "unclear"]), evidence: z.string(), slides: z.array(z.number().int()).optional(), fix: z.string().optional() })) });

export async function reviewCompliance(carouselId: number): Promise<{ reviewed: number }> {
  const c = getCarousel(carouselId)!; await ensureGuidelines(c.lookbook_id);
  const ctx = loadCtx(c.lookbook_id), spec = ctx.spec, copy = c.copy!;
  const e = await loadEnv(carouselId), checked = new Map<string, Status>();
  // review the AI-method guidelines plus code checks that came back undecided
  const targets: Guideline[] = [];
  const isSingle = spec.formats.some((f) => f.id === copy.format && f.kind === "single");
  for (const g of [...spec.guidelines.filter((x) => x.enabled && !(isSingle && carouselOnly(x))), ...(isQuiz(e) ? [QUIZ_GUIDELINE] : [])]) { if (g.method === "review") targets.push(g); else if (g.method === "code") { const r = await evalGuideline(g, e).catch(() => ({ status: "pending" as Status, evidence: "" })); checked.set(g.id, r.status); if (r.status === "pending") targets.push(g); } }
  if (!targets.length) { saveReview(carouselId, { at: new Date().toISOString(), hash: copyHash(c), results: {} }); return { reviewed: 0 }; }
  const p = await loadPrompt("review.md");
  const deck = copy.slides.map((s) => `Slide ${s.idx} [${s.archetype}] ${JSON.stringify(Object.fromEntries(slotsOf(e, s).filter((x) => x.text).map((x) => [x.name, plain(x.text)])))}`).join("\n");
  const user = [`Language: ${LANGUAGES[c.language]}. Topic: ${c.topic}`, `Brand voice: ${spec.voice.summary}\nExample lines: ${spec.voice.examples.slice(0, 3).join(" | ")}`, `Carousel (${copy.slides.length} slides):\n${deck}`, `Captions:\nInstagram: ${copy.captions.instagram.text}\nLinkedIn: ${copy.captions.linkedin.text}\nSources/assumptions: ${copy.sources_note ?? "(none)"}`,
    `Guidelines to judge (id: statement | look book quote):\n${targets.map((g) => `${g.id}: ${g.statement} | “${g.quote}”${g.check?.type === "slide_role" ? ` | applies to slides ${roleSlides(String((g.check.params as any).position), copy.slides.length).join(",")}` : ""}`).join("\n")}`].join("\n\n");
  const { data } = await llmCall({ stage: "carousel.review", tier: "text_cheap", system: p.body, user, schema: Review, carouselId, maxOutTokens: 4000, thinking: 800 });
  const results: ReviewCache["results"] = {};
  for (const r of data.results) if (targets.some((g) => g.id === r.id)) results[r.id] = { status: r.status, evidence: r.evidence.slice(0, 220), slides: r.slides, fix: r.fix?.slice(0, 160) };
  saveReview(carouselId, { at: new Date().toISOString(), hash: copyHash(c), results });
  return { reviewed: Object.keys(results).length };
}
