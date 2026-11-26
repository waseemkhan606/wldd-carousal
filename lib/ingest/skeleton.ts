// Deterministic template skeleton: a kit archetype built straight from the PDF's measured geometry (no model call).
// Every box, font size, line pitch, alignment, ink and shape comes from vector data, so the same look book always
// yields the same layout. The model is then only needed for what geometry cannot say (slot meaning, decoration CSS).
import type { GLine, GShape, PageGeometry } from "./geometry";
import type { StyleSpec } from "./spec";
import { colorVar, fontVar } from "./kit";

export type SBlock = { weight?: number; lines: GLine[]; x: number; y: number; w: number; h: number; px: number; pitch: number; font?: string; color: string; align: GLine["align"]; tracked: boolean; text: string; upper: boolean };
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
  const lines = mergeFragments(lines0).sort((a, b) => a.y - b.y || a.x - b.x);
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
    return { lines: g, x: x0, y: y0, w: x1 - x0, h: y1 - y0, px, pitch: pitches.length ? median(pitches) : 0, font: g[0].font, weight: g[0].weight, color: g[0].color, align: g[0].align, tracked: !!g[0].tracked, text, upper: /\p{L}{3}/u.test(text) && text === text.toUpperCase() };
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
  const blocks = classify(toBlocks(g.lines), g.shapes).map((b) => ({ ...b, visible: visible(b) }));
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
