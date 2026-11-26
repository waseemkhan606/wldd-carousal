// Deterministic template skeleton: a kit archetype built straight from the PDF's measured geometry (no model call).
// Every box, font size, line pitch, alignment, ink and shape comes from vector data, so the same look book always
// yields the same layout. The model is then only needed for what geometry cannot say (slot meaning, decoration CSS).
import type { GLine, GShape, PageGeometry } from "./geometry";
import type { StyleSpec } from "./spec";
import { colorVar, fontVar } from "./kit";

export type SBlock = { rotationDeg?: number; weight?: number; lines: GLine[]; x: number; y: number; w: number; h: number; px: number; pitch: number; font?: string; color: string; align: GLine["align"]; tracked: boolean; text: string; upper: boolean };
export type SkRole = { name: string; kind: string; furniture?: boolean; static?: boolean };
export type SkBlock = SBlock & { role: SkRole; boxed?: GShape; maxH: number; visible?: string };
export type Skeleton = { html: string; sample_slots: Record<string, string>; slots: { name: string; kind: string; max_words: number; max_chars: number; optional: boolean }[]; blocks: SkBlock[] };

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]); };
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const r = Math.round;

/** Pieces of one visual line that the PDF split into separate runs ("READ THIS FIRS" + "T") are glued back together. */
export function mergeFragments(lines: GLine[]): GLine[] {
  const out: GLine[] = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const prev = out.find((p) => {
      const oy = Math.min(p.y + p.h, l.y + l.h) - Math.max(p.y, l.y);
      const gap = l.x - (p.x + p.w);
      return oy > 0.6 * Math.min(p.h, l.h) && gap > -4 && gap < Math.max(6, 0.5 * Math.min(p.estFontPx, l.estFontPx)) && (p.font === l.font || l.w < 0.2 * p.w) && dist(p.color, l.color) < 90;
    });
    if (!prev) { out.push({ ...l }); continue; }
    const tight = l.x - (prev.x + prev.w) < 0.18 * prev.estFontPx || /^[₹$€£¥]$/.test(prev.text.trim().slice(-1)) && /^[\d]/.test(l.text);
    prev.text = tight ? prev.text + l.text : prev.text + " " + l.text;
    const x1 = Math.max(prev.x + prev.w, l.x + l.w), y0 = Math.min(prev.y, l.y), y1 = Math.max(prev.y + prev.h, l.y + l.h);
    prev.w = x1 - prev.x; prev.y = y0; prev.h = y1 - y0;
  }
  return out;
}

/** Lines of the same style stacked within about one line pitch form a block (a headline that wraps, a paragraph). */
export function toBlocks(lines0: GLine[]): SBlock[] {
  const lines = mergeFragments(lines0.filter((l) => l.text.trim())).sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: GLine[][] = [];
  for (const l of lines) {
    const g = groups.find((grp) => {
      const last = grp[grp.length - 1];
      const gap = l.y - (last.y + last.h);
      const sameStyle = last.font === l.font && Math.abs(last.estFontPx - l.estFontPx) <= Math.max(2, 0.08 * l.estFontPx) && dist(last.color, l.color) < 70 && last.align === l.align;
      const aligned = l.align === "center" ? Math.abs(last.x + last.w / 2 - (l.x + l.w / 2)) < 16 : l.align === "right" ? Math.abs(last.x + last.w - (l.x + l.w)) < 14 : Math.abs(last.x - l.x) < 14;
      return sameStyle && aligned && gap > -0.4 * l.h && gap < 0.6 * l.h;
    });
    if (g) g.push(l); else groups.push([l]);
  }
  return groups.map((g) => {
    const x0 = Math.min(...g.map((l) => l.x)), y0 = Math.min(...g.map((l) => l.y)), x1 = Math.max(...g.map((l) => l.x + l.w)), y1 = Math.max(...g.map((l) => l.y + l.h));
    const px = r(median(g.map((l) => l.estFontPx)));
    const pitches = g.slice(1).map((l, i) => l.y - g[i].y);
    const text = g.map((l) => l.text).join(" ").replace(/([₹$€£¥])\s+(?=\d)/g, "$1"); // the PDF often carries a stray space after a currency sign
    return { lines: g, x: x0, y: y0, w: x1 - x0, h: y1 - y0, px, pitch: pitches.length ? median(pitches) : 0, font: g[0].font, weight: g[0].weight, rotationDeg: g[0].rotationDeg, color: g[0].color, align: g[0].align, tracked: !!g[0].tracked, text, upper: /\p{L}{3}/u.test(text) && text === text.toUpperCase() };
  });
}

const inside = (b: { x: number; y: number; w: number; h: number }, s: GShape) => b.x >= s.x - 12 && b.y >= s.y - 12 && b.x + b.w <= s.x + s.w + 12 && b.y + b.h <= s.y + s.h + 12;

/** Which kind of thing each block is, from size, position and shapes only. */
export function classify(blocks: SBlock[], shapes: GShape[]): SkBlock[] {
  const used = new Map<string, number>();
  const nm = (base: string) => { const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base}_${n}`; };
  const body = blocks.filter((b) => b.px > 0);
  const maxPx = Math.max(...body.map((b) => b.px), 1);
  const headline = [...body].sort((a, b) => b.px * Math.min(1, b.text.length / 4) - a.px * Math.min(1, a.text.length / 4))[0];
  const boxes = shapes.filter((s) => s.fill && s.w > 60 && s.h > 30 && s.w < 1000 && s.h < 700);
  return blocks.map((b): SkBlock => {
    const boxed = boxes.filter((s) => inside(b, s)).sort((a, c) => a.w * a.h - c.w * c.h)[0];
    const below = blocks.filter((o) => o !== b && o.y > b.y + b.h - 4 && o.x < b.x + b.w && o.x + o.w > b.x).map((o) => o.y);
    const free = (below.length ? Math.min(...below) : 1290) - b.y - 18;
    const maxH = Math.max(b.h, Math.min(free, b.h * 1.4 + b.px * 0.6));
    let role: SkRole;
    if (/^\d{1,2}\s*[/·]\s*\d{1,2}$/.test(b.text.trim())) role = { name: "slide counter", kind: "counter", furniture: true };
    else if (b.y >= 1130 && b.px <= 0.45 * maxPx && !boxed) role = { name: "", kind: "static", static: true };
    else if (boxed && b.text.length <= 4 && b.px <= 0.5 * maxPx && boxes.filter((s) => inside(b, s)).length && body.filter((o) => inside(o, boxed)).length === 1 && b.w < 60) role = { name: nm("label"), kind: "tag" };
    else if (boxed) role = { name: nm(body.filter((o) => inside(o, boxed)).length > 1 && b.px < 0.6 * maxPx && b.text.length < 3 ? "marker" : b.text.length < 24 && b.align !== "left" ? "stamp_text" : "option"), kind: "body" };
    else if (b === headline && b.px >= 0.3 * maxPx) role = { name: nm("headline"), kind: "headline" };
    else if (b.y < 200 && b.px <= 0.35 * maxPx && b.text.split(/\s+/).length <= 8) role = { name: nm("tag"), kind: "tag" };
    else if (b.y > 950 && b.text.split(/\s+/).length <= 4) role = { name: nm("cta"), kind: "cta" };
    else if (b.px >= 0.35 * maxPx && b.px > headline.px * 0.4 && b !== headline) role = { name: nm("subhead"), kind: "headline" };
    else role = { name: nm("body"), kind: "body" };
    return { ...b, role, boxed, maxH };
  });
}

const nearestColor = (hex: string, spec: StyleSpec) => [...spec.colors].sort((a, b) => dist(a.hex, hex) - dist(b.hex, hex))[0];
const fontRole = (name: string | undefined, spec: StyleSpec) => spec.fonts.find((f) => name && (squash(f.family) === squash(name) || squash(f.family).includes(squash(name)) || squash(name).includes(squash(f.family)))) ?? spec.fonts[0];

/** One archetype's HTML from its measured geometry. `bgToken` is the archetype's background colour token. */
export function skeletonFor(g: PageGeometry, spec: StyleSpec, bgToken: string, visible: (b: SBlock) => string | undefined = () => undefined): Skeleton {
  const bgHex = spec.colors.find((c) => c.token === bgToken)?.hex ?? "#FFFFFF";
  const blocks = classify(toBlocks(prepareLines(g)), g.shapes).map((b) => ({ ...b, visible: visible(b) }));
  const css = (b: SkBlock) => {
    const lh = b.pitch ? b.pitch / b.px : 1.12;
    const top = b.lines[0].y + b.lines[0].h / 2 - (b.pitch || b.px * 1.12) / 2;
    const multi = b.lines.length > 1;
    const slack = multi ? Math.max(b.px * 0.6, b.w * 0.06) : b.px * 0.6;
    let left = b.x, width = b.w + slack;
    if (b.align === "center") { left = b.x - slack / 2; }
    else if (b.align === "right") { left = b.x - slack; }
    if (!multi && b.align === "left") width = Math.max(width, Math.min(1080 - 60 - b.x, 1080 - b.x - 60));
    if (!multi && b.align === "right") { left = 60; width = b.x + b.w - 60 + 0; }
    if (!multi && b.align === "center") { const half = Math.min(b.x + b.w / 2, 1080 - (b.x + b.w / 2)) - 60; left = b.x + b.w / 2 - half; width = half * 2; }
    const fr = fontRole(b.font, spec);
    const bgc = nearestColor(b.boxed?.fill ?? bgHex, spec);
    const ink = b.visible ?? b.color; // ink as painted (alpha applied), vs the PDF's nominal colour
    const fit = bestInk(ink, b.color, bgc.hex, spec);
    const colour = fit.alpha < 100 ? `color-mix(in srgb, var(${colorVar(fit.token)}) ${fit.alpha}%, transparent)` : `var(${colorVar(fit.token)})`;
    return `position:absolute;left:${r(left)}px;top:${r(top)}px;width:${r(width)}px;height:${r(Math.max(b.maxH, (b.pitch || b.px * 1.12) * b.lines.length))}px;font-family:var(${fontVar(fr.role)});${b.weight && b.weight !== 400 ? `font-weight:${b.weight};` : ""}font-size:${b.px}px;line-height:${lh.toFixed(3)};color:${colour};text-align:${b.align === "single" ? "left" : b.align};${b.upper ? "text-transform:uppercase;" : ""}${b.tracked ? "letter-spacing:.14em;" : ""}`;
  };
  const shapeHtml = g.shapes.filter((s) => !(s.w > 1000 && s.h > 1200)).map((s) => {
    const fc = s.fill ? nearestColor(s.fill, spec) : undefined, sc = s.stroke ? nearestColor(s.stroke, spec) : undefined;
    return `<div style="position:absolute;left:${r(s.x)}px;top:${r(s.y)}px;width:${r(s.w)}px;height:${r(s.h)}px;${fc ? `background:var(${colorVar(fc.token)});` : ""}${sc ? `border:3px solid var(${colorVar(sc.token)});` : ""}${s.rotationDeg ? `transform:rotate(${s.rotationDeg}deg);` : ""}"></div>`;
  }).join("\n  ");
  const sample: Record<string, string> = {}, slots: Skeleton["slots"] = [];
  const els = blocks.map((b) => {
    if (b.role.furniture) return `<div data-furniture="${b.role.name}" style="${css(b)}white-space:nowrap">{{idx}} / {{total}}</div>`;
    if (b.role.static) return `<div style="${css(b)}">${b.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
    sample[b.role.name] = b.text;
    const words = b.text.split(/\s+/).length;
    slots.push({ name: b.role.name, kind: b.role.kind, max_words: Math.max(4, Math.ceil(words * 1.6)), max_chars: Math.max(24, Math.ceil(b.text.length * 1.7)), optional: false });
    return `<div data-slot="${b.role.name}" data-max-size="${b.px}" data-min-size="${Math.max(14, r(b.px * 0.55))}" style="${css(b)}"></div>`;
  }).join("\n  ");
  const html = `<div class="slide" style="position:relative;width:1080px;height:1350px;overflow:hidden;background:var(${colorVar(bgToken)})">\n  ${shapeHtml}\n  ${els}\n</div>`;
  return { html, sample_slots: sample, slots, blocks };
}

/** The palette colour at some opacity that best reproduces the ink as painted over its background. */
export function bestInk(painted: string, nominal: string, bgHex: string, spec: StyleSpec): { token: string; alpha: number } {
  const mix = (c: string, a: number) => { const x = rgb(c), y = rgb(bgHex); return "#" + x.map((v, i) => Math.round(v * a + y[i] * (1 - a)).toString(16).padStart(2, "0")).join(""); };
  let best = { token: nearestColor(nominal, spec).token, alpha: 100, err: Infinity };
  for (const c of spec.colors) {
    if (dist(c.hex, bgHex) < 90) continue; // invisible on this background
    for (let a = 100; a >= 40; a -= 5) {
      const e = dist(mix(c.hex, a / 100), painted) + (100 - a) * 0.35 + (c.token === nearestColor(nominal, spec).token ? 0 : 12);
      if (e < best.err) best = { token: c.token, alpha: a, err: e };
    }
  }
  return { token: best.token, alpha: best.alpha };
}

// ───────────────────────── spec-driven kit ─────────────────────────
// The look book's spec says WHAT each template contains (slots, furniture); the geometry says WHERE and HOW it is drawn.
import sharp from "sharp";
import { inkColor } from "./geometry";
import type { KitOutput } from "./kit";

type SpecArch = StyleSpec["archetypes"][number];
export type SlotDef = { name: string; kind: string; max_words: number; max_chars: number; optional: boolean };
type Cls = "head" | "tag" | "cta" | "stamp" | "list" | "body";
export type Furn = "counter" | "logo" | "handle" | "brand" | "other";

export const furnKind = (what: string): Furn => /\bcounter\b|\bcount\b|slide ?(no|num|n)\b|pagination|page ?(no|num)|\bindex\b|\d ?\/ ?\d/i.test(what) ? "counter" : /logo|mark|emblem|icon|badge|monogram/i.test(what) ? "logo" : /handle|@|username|account|url|link/i.test(what) ? "handle" : /brand|wordmark|name|publisher|footer/i.test(what) ? "brand" : "other";
export const slotClass = (s: { name: string; kind: string }): Cls => {
  const by = (t: string): Cls | null => /^(stamp|stamp_text)$/.test(t) ? "stamp" : /^(cta|call_to_action|action)$/.test(t) ? "cta" : /^(tag|label|kicker|eyebrow|category|pill|badge)$/.test(t) ? "tag" : /^(list|option|options|choice|answer|item|step|bullets?)$/.test(t) ? "list" : /^(headline|title|number|stat|figure|hero|quote|question|subhead|subheadline|big_number|heading)$/.test(t) ? "head" : /^(body|text|paragraph|copy|description|caption)$/.test(t) ? "body" : null;
  if (/^(option|choice|answer)[_ -]?[a-z0-9]*$/i.test(s.name)) return "list"; // a slot called option_a is an option whatever its kind says
  const k = by(s.kind.toLowerCase().replace(/[\s-]+/g, "_")); if (k) return k;
  const t = `${s.kind} ${s.name}`.toLowerCase();
  return /sub-?title|subtext|caption|description|summary|paragraph|body|explanation|blurb|note|maths|example/.test(t) ? "body" : /stamp/.test(t) ? "stamp" : /cta|swipe|call.?to/.test(t) ? "cta" : /tag|kicker|eyebrow|label|category|pill|section|topic/.test(t) ? "tag" : /option|choice|answer|item|step|list|bullet/.test(t) ? "list" : /head|title|number|stat|figure|hero|quote|question/.test(t) ? "head" : "body";
};
/** What a block is, from how it is drawn: boxed text, tracked caps or tilted text are stamps/labels; unusually large body text is a sub-headline. */
function classes(blocks: SkBlock[]): Map<SkBlock, Cls> {
  const bodyPx = blocks.filter((b) => b.role.kind === "body" && !b.boxed).map((b) => b.px).sort((x, y) => x - y), med = bodyPx[Math.floor(bodyPx.length / 2)] ?? 0;
  return new Map(blocks.map((b) => {
    const words = b.text.trim().split(/\s+/).length;
    const c: Cls = b.role.static && /→|swipe|follow|save|share|link in bio|read more/i.test(b.text) ? "cta" : b.boxed && b.role.kind === "tag" ? "tag" : b.boxed ? (b.role.name.startsWith("stamp") ? "stamp" : "list")
      : b.rotationDeg || (b.tracked && b.upper && words <= 4 && b.y > 200 && b.role.kind !== "tag" && !b.role.static) ? "stamp"
      : b.role.kind === "headline" ? "head" : b.role.kind === "tag" ? "tag" : b.role.kind === "cta" ? "cta"
      : med && b.px >= 1.45 * med && words <= 12 ? "head" : "body";
    return [b, c];
  }));
}
const COMPAT: Record<Cls, Partial<Record<Cls, number>>> = {
  head: { head: 10, body: 3, tag: 1 }, tag: { tag: 10, cta: 3, body: 2, head: 1 }, cta: { cta: 10, body: 4, tag: 3 },
  stamp: { stamp: 10, tag: 4, cta: 4, body: 2, list: 2 }, list: { list: 10, body: 4, stamp: 1 }, body: { body: 10, list: 4, cta: 3, head: 2, tag: 1 },
};

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
type Placed = { top: number; left: number; width: number; height: number; css: string };

/** Absolute box + typography for a block (shared by slots, furniture and static text). */
function boxCss(b: SkBlock, spec: StyleSpec, bgHex: string): string {
  const multi = b.lines.length > 1, pitch = b.pitch || b.px * 1.12, lh = b.pitch ? b.pitch / b.px : 1.12;
  const top = b.lines[0].y + b.lines[0].h / 2 - pitch / 2, slack = multi ? Math.max(b.px * 0.6, b.w * 0.06) : b.px * 0.6;
  let left = b.x, width = b.w + slack;
  if (b.align === "center") left = b.x - slack / 2; else if (b.align === "right") left = b.x - slack;
  if (!multi && b.align === "left") width = Math.max(width, 1080 - 60 - b.x);
  if (!multi && b.align === "right") { left = 60; width = b.x + b.w - 60; }
  if (!multi && b.align === "center") { const half = Math.min(b.x + b.w / 2, 1080 - (b.x + b.w / 2)) - 60; left = b.x + b.w / 2 - half; width = half * 2; }
  // the spec's safe margins hold for every slot and furniture box (a tilted stamp is positioned by its centre and left alone)
  if (!b.rotationDeg) {
    const m = spec.layout.margins_px, mg = typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m;
    left = Math.max(left, mg.left); width = Math.max(Math.min(width, 1080 - mg.right - left), Math.min(b.w, 1080 - mg.right - left));
  }
  const fr = fontRole(b.font, spec), bgc = nearestColor(b.boxed?.fill ?? bgHex, spec), fit = bestInk(b.visible ?? b.color, b.color, bgc.hex, spec);
  const wt = b.weight && fr.weights.length ? fr.weights.reduce((p, q) => (Math.abs(q - b.weight!) < Math.abs(p - b.weight!) ? q : p)) : undefined; // only a weight the brand font really has
  const bottomLimit = 1350 - (typeof spec.layout.margins_px === "number" ? spec.layout.margins_px : spec.layout.margins_px.bottom), hMax = Math.max(pitch * b.lines.length, b.maxH), h = b.rotationDeg ? hMax : Math.max(pitch * b.lines.length, Math.min(hMax, bottomLimit - Math.max(top, 0)));
  const colour = fit.alpha < 100 ? `color-mix(in srgb, var(${colorVar(fit.token)}) ${fit.alpha}%, transparent)` : `var(${colorVar(fit.token)})`;
  return `position:absolute;left:${r(left)}px;top:${r(top)}px;width:${r(width)}px;height:${r(h)}px;font-family:var(${fontVar(fr.role)});${wt && wt !== 400 ? `font-weight:${wt};` : ""}font-size:${b.px}px;line-height:${lh.toFixed(3)};color:${colour};text-align:${b.align === "single" ? "left" : b.align};${b.upper ? "text-transform:uppercase;" : ""}${b.tracked ? "letter-spacing:.14em;" : ""}${b.rotationDeg ? `transform:rotate(${b.rotationDeg}deg);white-space:nowrap;` : ""}`;
}

const corner = (position: string) => ({ right: /right/i.test(position), bottom: /bottom|foot/i.test(position) });

/** One archetype from its geometry and the spec's slots/furniture. Returns null (with a reason) when the geometry can't honour the spec. */
export function skeletonForSpec(g: PageGeometry, spec: StyleSpec, a: SpecArch, visible: (b: SBlock) => string | undefined, logo?: { what: string; box: { x: number; y: number; w: number; h: number } } | null): { html: string; sample_slots: Record<string, string>; extra: SlotDef[] } | { fail: string } {
  const bgHex = spec.colors.find((c) => c.token === a.background_token)?.hex ?? "#FFFFFF";
  const noFont = g.lines.filter((l) => !l.font).length;
  if (g.lines.length && noFont / g.lines.length > 0.3) return { fail: `the PDF reader did not report fonts for ${noFont} of ${g.lines.length} text lines` };
  const all: SkBlock[] = classify(toBlocks(prepareLines(g)), g.shapes).map((b) => ({ ...b, visible: visible(b) }));
  const inLogo = (b: { x: number; y: number; w: number; h: number }) => !!logo && b.x >= logo.box.x - 14 && b.y >= logo.box.y - 14 && b.x + b.w <= logo.box.x + logo.box.w + 14 && b.y + b.h <= logo.box.y + logo.box.h + 14;
  const free = all.filter((b) => !inLogo(b)); // the real logo asset replaces whatever the PDF draws there
  const parts: string[] = [], sample: Record<string, string> = {};
  const used = new Set<SkBlock>();
  // furniture first: each spec item is placed from the matching block, else at its stated corner
  const minPx = Math.min(...free.map((b) => b.px), 24);
  for (const f of spec.layout.fixed_furniture) {
    const kind = furnKind(f.what), pos = corner(f.position);
    const text = kind === "counter" ? "{{idx}} / {{total}}" : kind === "handle" ? "{{handle}}" : kind === "brand" ? "{{brand}}" : undefined;
    if (kind === "logo") {
      const box = logo?.what === f.what ? logo.box : { x: pos.right ? 1080 - 60 - 80 : 60, y: pos.bottom ? 1350 - 60 - 80 : 60, w: 80, h: 80 };
      parts.push(`<div data-furniture="${f.what}" style="position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></div>`);
      continue;
    }
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cand = free.filter((b) => !used.has(b) && !b.boxed).filter((b) => kind === "counter" ? /^\d{1,2}\s*[/·]\s*\d{1,2}$/.test(b.text.trim()) : kind === "handle" ? /^@/.test(b.text.trim()) || (!!spec.brand.handle && norm(b.text) === norm(spec.brand.handle)) : kind === "brand" ? norm(b.text) === norm(spec.brand.name) || (b.role.static === true && b.px <= minPx * 1.4) : (b.role.static === true && Math.abs(b.y - (pos.bottom ? 1250 : 90)) < 160 && (pos.right ? b.x > 540 : b.x < 540)));
    const b = cand[0];
    if (b) {
      used.add(b);
      parts.push(`<div data-furniture="${f.what}" style="${boxCss(b, spec, bgHex)}white-space:nowrap">${text ?? esc(b.text)}</div>`);
    } else {
      // not drawn on this sample: placed at the stated corner (hidden later if this archetype's own reference never shows it)
      const donor = [...free].sort((x, y) => x.px - y.px)[0];
      const css = donor ? boxCss({ ...donor, align: pos.right ? "right" : "left" }, spec, bgHex).replace(/left:-?\d+px;top:-?\d+px;width:-?\d+px/, `left:${pos.right ? 540 : 60}px;top:${pos.bottom ? 1350 - 60 - Math.round(donor.px * 1.3) : 60}px;width:480px`) : `position:absolute;left:60px;top:60px;width:300px;height:40px;font-size:24px;color:var(${colorVar(spec.colors[0].token)})`;
      parts.push(`<div data-furniture="${f.what}" style="${css}white-space:nowrap;display:none">${text ?? ""}</div>`); // this sample does not show it, so it starts hidden (the pipeline hides absent furniture anyway)
    }
  }
  // an option letter (A, B, C...) is a label, not an answer: boxed, at most 2 characters and much smaller than the boxed answers
  const boxedMax = Math.max(...free.filter((b) => b.boxed).map((b) => b.px), 0), isMarker = (b: SkBlock) => !!b.boxed && b.text.trim().length <= 2 && b.px <= 0.6 * boxedMax;
  // slots: pair slots with blocks of the same kind, in reading order
  const cand = free.filter((b) => !used.has(b) && !b.role.furniture && !isMarker(b) && !(b.role.static && b.y >= 1130 && !/→|swipe|follow|save|share|link in bio|read more/i.test(b.text)));
  const pairs: { s: number; b: number; score: number }[] = [];
  const byY = [...cand].sort((x, y) => x.y - y.y || x.x - y.x), cls = classes(byY), blockClass = (b: SkBlock) => cls.get(b) ?? "body";
  a.slots.forEach((s, si) => {
    const sc = slotClass(s); const sRank = a.slots.filter((o, oi) => oi < si && slotClass(o) === sc).length;
    byY.forEach((b, bi) => {
      const bc = blockClass(b); const base = COMPAT[sc][bc] ?? 0; if (!base) return;
      const bRank = byY.filter((o, oi) => oi < bi && blockClass(o) === bc).length;
      const words = b.text.split(/\s+/).length, fit = words <= s.max_words * 1.3 ? 1.5 : -3;
      pairs.push({ s: si, b: bi, score: base + fit - Math.abs(bRank - sRank) * 0.7 });
    });
  });
  pairs.sort((p, q) => q.score - p.score);
  if (process.env.SKEL_DEBUG) console.error(a.id, "classes", byY.map((b) => `${blockClass(b)}:${b.text.slice(0, 14)}`).join(" | "), "pairs", pairs.slice(0, 12).map((p) => `${a.slots[p.s].name}<-${byY[p.b].text.slice(0, 10)}(${p.score.toFixed(1)})`).join(" "));
  const slotOf = new Map<number, number>(), blockTaken = new Set<number>();
  for (const p of pairs) { if (slotOf.has(p.s) || blockTaken.has(p.b) || p.score < 2) continue; slotOf.set(p.s, p.b); blockTaken.add(p.b); }
  const missing = a.slots.map((s, i) => ({ s, i })).filter(({ i }) => !slotOf.has(i));
  const blocksUsed = [...blockTaken].map((i) => byY[i]);
  const bottom = Math.max(...blocksUsed.map((b) => b.y + b.h), 0);
  const donor = blocksUsed.find((b) => blockClass(b) === "body") ?? blocksUsed[blocksUsed.length - 1];
  for (const { s, i } of missing) {
    if (!s.optional) return { fail: `no block for required slot "${s.name}" (${s.kind})` };
    if (!donor) return { fail: "no text blocks to model the optional slot on" };
    // optional slot with no counterpart in this sample: room under the content, styled like the body text
    const same = blocksUsed.find((b) => blockClass(b) === slotClass(s)) ?? donor;
    const height = r(Math.min(same.px * 2.6, 200)), top = Math.min(bottom + 28, 1290 - height), left = Math.max(60, r(same.x)), width = Math.max(300, 1020 - left);
    const css = boxCss(same, spec, bgHex).replace(/left:-?\d+px;top:-?\d+px;width:-?\d+px;height:-?\d+px/, `left:${left}px;top:${r(top)}px;width:${width}px;height:${height}px`);
    parts.push(`<div data-slot="${s.name}" data-max-size="${same.px}" data-min-size="${Math.max(14, r(same.px * 0.55))}" style="${css}"></div>`);
  }
  for (const [si, bi] of slotOf) {
    const s = a.slots[si], b = byY[bi]; used.add(b);
    sample[s.name] = b.text;
    parts.push(`<div data-slot="${s.name}" data-max-size="${b.px}" data-min-size="${Math.max(14, r(b.px * 0.55))}" style="${boxCss(b, spec, bgHex)}"></div>`);
  }
  // what is left: small fixed text (a footer, an option letter) stays as static text; copy-like leftovers are dropped, never frozen into the template
  const extra: SlotDef[] = [];
  const taken = new Set([...a.slots.map((x) => x.name)]);
  const KIND: Record<Cls, string> = { head: "headline", tag: "tag", cta: "cta", stamp: "stamp_text", list: "body", body: "body" }, BASE: Record<Cls, string> = { head: "subhead", tag: "tag", cta: "cta", stamp: "stamp_text", list: "body", body: "body" };
  for (const b of free) {
    if (used.has(b) || b.role.furniture) continue;
    if (b.text.trim().length <= 3 || (b.role.static && b.y >= 1130)) { parts.push(`<div style="${boxCss(b, spec, bgHex)}">${esc(b.text)}</div>`); continue; }
    // copy the spec has no slot for: it becomes an optional slot, so the template keeps that line instead of freezing or losing it
    if (extra.length >= 2 || b.boxed) continue;
    const bc = blockClass(b); let name = BASE[bc], n = 1; while (taken.has(name)) name = `${BASE[bc]}_${++n}`; taken.add(name);
    const words = b.text.trim().split(/\s+/).length;
    extra.push({ name, kind: KIND[bc], max_words: Math.max(4, Math.ceil(words * 1.6)), max_chars: Math.max(24, Math.ceil(b.text.length * 1.7)), optional: true });
    sample[name] = b.text;
    parts.push(`<div data-slot="${name}" data-max-size="${b.px}" data-min-size="${Math.max(14, r(b.px * 0.55))}" style="${boxCss(b, spec, bgHex)}"></div>`);
  }
  const shapes = g.shapes.filter((s) => !(s.w > 1000 && s.h > 1200) && !inLogo(s)).map((s) => {
    const fc = s.fill ? nearestColor(s.fill, spec) : undefined, sc = s.stroke ? nearestColor(s.stroke, spec) : undefined;
    return `<div style="position:absolute;left:${r(s.x)}px;top:${r(s.y)}px;width:${r(s.w)}px;height:${r(s.h)}px;${fc ? `background:var(${colorVar(fc.token)});` : ""}${sc ? `border:3px solid var(${colorVar(sc.token)});` : ""}${s.rotationDeg ? `transform:rotate(${s.rotationDeg}deg);` : ""}"></div>`;
  });
  return { html: `<div class="slide" style="position:relative;width:1080px;height:1350px;overflow:hidden;background:var(${colorVar(a.background_token)})">\n  ${shapes.join("\n  ")}\n  ${parts.join("\n  ")}\n</div>`, sample_slots: sample, extra };
}

export type SkelKit = { kit: KitOutput; covered: string[]; missing: string[]; notes: string[]; extra: Record<string, SlotDef[]> };
/** Every archetype that has measured geometry and can honour the spec; the rest are left for the model. No model call here. */
export async function skeletonKit(spec: StyleSpec, geoOf: (id: string) => PageGeometry | undefined, logo?: { what: string; box: { x: number; y: number; w: number; h: number } } | null): Promise<SkelKit> {
  const archetypes: KitOutput["archetypes"] = [], covered: string[] = [], missing: string[] = [], notes: string[] = [], extra: Record<string, SlotDef[]> = {};
  for (const a of spec.archetypes) {
    const g = geoOf(a.id);
    if (!g) { missing.push(a.id); notes.push(`${a.id}: no sample geometry`); continue; }
    const raw = await sharp(g.referencePng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = skeletonForSpec(g, spec, a, (b) => inkColor(raw.data, raw.info.width, b), logo);
    if ("fail" in out) { missing.push(a.id); notes.push(`${a.id}: ${out.fail}`); continue; }
    archetypes.push({ id: a.id, html: out.html, sample_slots: out.sample_slots }); covered.push(a.id); if (out.extra.length) extra[a.id] = out.extra;
  }
  return { kit: { css: "[data-slot] em{font-style:inherit;font-weight:inherit}", archetypes }, covered, missing, notes, extra };
}


const wordGap = (ws: { x: number; w: number }[]) => ws.slice(1).map((w, i) => Math.max(0, w.x - (ws[i].x + ws[i].w)));
/** Text as the page really reads: letter-spaced words rebuilt from gaps; a tilted stamp, which the PDF stores letter by letter, put back into one line. */
export function prepareLines(g: PageGeometry): GLine[] {
  const lines = g.lines.map((l) => ({ ...l }));
  for (const l of lines) {
    const ws = g.words.filter((w) => w.x + w.w / 2 >= l.x - 2 && w.x + w.w / 2 <= l.x + l.w + 2 && w.y + w.h / 2 >= l.y - 2 && w.y + w.h / 2 <= l.y + l.h + 2).sort((a, b) => a.x - b.x);
    if (!l.tracked || ws.length < 4 || ws.filter((w) => w.text.length <= 2).length / ws.length < 0.6) continue; // only text the PDF itself marks as letter-spaced
    const gaps = wordGap(ws), thr = Math.max(1.7 * median(gaps), l.estFontPx * 0.22);
    l.text = ws.map((w, i) => (i && gaps[i - 1] > thr ? " " : "") + w.text).join(""); l.tracked = true;
  }
  // tilted text: runs of 1-2 character lines on a slanted straight line
  const taken = new Set<GLine>(); const out: GLine[] = [];
  const singles = lines.filter((l) => l.text.trim().length <= 2);
  const seeds = singles.filter((l) => !taken.has(l));
  for (const s0 of seeds) {
    if (taken.has(s0)) continue;
    const grp = singles.filter((l) => !taken.has(l) && l.font === s0.font && Math.abs(l.estFontPx - s0.estFontPx) <= 2);
    if (grp.length < 4) continue;
    const cx = (l: GLine) => l.x + l.w / 2, cy = (l: GLine) => l.y + l.h / 2, n = grp.length, mx = grp.reduce((t, l) => t + cx(l), 0) / n, my = grp.reduce((t, l) => t + cy(l), 0) / n;
    const sxx = grp.reduce((t, l) => t + (cx(l) - mx) ** 2, 0), a = sxx ? grp.reduce((t, l) => t + (cx(l) - mx) * (cy(l) - my), 0) / sxx : 0, c = my - a * mx;
    const tol = 0.35 * s0.estFontPx, on = (l: GLine) => Math.abs(cy(l) - (a * cx(l) + c)) < tol;
    const run = lines.filter((l) => !taken.has(l) && l.font === s0.font && Math.abs(l.estFontPx - s0.estFontPx) <= 2 && on(l)).sort((p, q) => p.x - q.x);
    if (run.length < 4 || Math.abs(a) > 0.6) continue;
    run.forEach((l) => taken.add(l));
    const steps = run.slice(1).map((l, i) => l.x - run[i].x), st = median(steps.filter((v) => v > 0)) || 1;
    const text = run.map((l, i) => (i && run[i].x - (run[i - 1].x + run[i - 1].w) > Math.max(1.0 * st, s0.estFontPx * 0.4) * 0.9 && run[i].x - run[i - 1].x > 1.6 * st ? " " : "") + l.text.trim()).join("");
    const x0 = run[0].x, x1 = Math.max(...run.map((l) => l.x + l.w)), mxx = (x0 + x1) / 2, h = run.reduce((t, l) => t + l.h, 0) / run.length;
    out.push({ ...run[0], text, x: x0, w: x1 - x0, y: a * mxx + c - h / 2, h, align: "center", tracked: true, rotationDeg: Math.round(Math.atan(a) * 1800 / Math.PI) / 10 });
  }
  return [...lines.filter((l) => !taken.has(l)), ...out];
}
