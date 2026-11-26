// Deterministic template polish, applied to EVERY kit at ingestion (never left to the model or to the user):
//  - stamps: one line, sized to the text, padded, never split from their box
//  - text clears decorative vertical rules (e.g. the red margin line of ruled paper) and stays inside the margins
// All free, all driven by the look book's own measurements and spec.
import type { StyleSpec } from "./spec";
import type { RenderDiag } from "../render/renderer";
import type { VLine } from "./decor";
import { editSlot } from "./autoalign";

const W = 1080, H = 1350;

/** Edit the inline style of the first opening tag matching `openRe` (used for stamp wrappers, which carry no data-slot). */
function editTag(html: string, openRe: RegExp, style: Record<string, string>): string {
  const m = openRe.exec(html); if (!m) return html;
  let tag = m[0];
  const styleM = /\sstyle="([^"]*)"/.exec(tag), decls = new Map<string, string>();
  for (const d of (styleM?.[1] ?? "").split(";")) { const i = d.indexOf(":"); if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim()); }
  for (const [k, v] of Object.entries(style)) decls.set(k, v);
  const s = [...decls].map(([k, v]) => `${k}:${v}`).join(";");
  tag = styleM ? tag.replace(/\sstyle="[^"]*"/, ` style="${s}"`) : tag.replace(/>$/, ` style="${s}">`);
  return html.slice(0, m.index) + tag + html.slice(m.index + m[0].length);
}

/** Stamps: nowrap, auto-sized box, comfortable padding, bold, legible size; the slot always sits inside its box. */
export function polishStamps(html: string, kinds: Record<string, string>): { html: string; changes: string[] } {
  const changes: string[] = [];
  for (const [name, kind] of Object.entries(kinds)) {
    if (kind !== "stamp_text") continue;
    // a stamp is either a wrapper box holding the slot, or the slot itself styled as the box
    const wrap = new RegExp(`<div(?=[^>]*class="[^"]*stamp[^"]*")[^>]*>(?=\\s*<[a-z0-9]+[^>]*data-slot=["']${name}["'])`, "i");
    if (!wrap.test(html)) { // self-contained stamp: keep its placement, just make it one line sized to its text
      html = editSlot(html, name, { style: { width: "auto", "white-space": "nowrap", "max-width": `${W - 180}px`, "line-height": "1.1" } });
      changes.push(`${name}: stamp kept on one line`); continue;
    }
    // wrapper case: the slot goes back into normal flow inside its wrapper (any offset it carried moves to the wrapper)
    const carried = new RegExp(`data-slot=["']${name}["'][^>]*?translate:\\s*(-?[\\d.]+)px\\s+(-?[\\d.]+)px`).exec(html);
    html = editSlot(html, name, { style: { position: "static", width: "auto", height: "auto", translate: "none", transform: "none", "white-space": "nowrap", "line-height": "1.1", "font-weight": "700", margin: "0", "min-width": "0" } });
    const wm = wrap.exec(html), wt = wm ? /translate:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(wm[0]) : null;
    const tx = (carried ? +carried[1] : 0) + (wt ? +wt[1] : 0), ty = (carried ? +carried[2] : 0) + (wt ? +wt[2] : 0);
    html = editTag(html, wrap, { ...(carried || wt ? { translate: `${Math.round(tx * 10) / 10}px ${Math.round(ty * 10) / 10}px` } : {}), width: "auto", height: "auto", "white-space": "nowrap", display: "inline-flex", "align-items": "center", "justify-content": "center", padding: "0.28em 0.7em", "max-width": `${W - 180}px` });
    changes.push(`${name}: stamp fitted to its text`);
  }
  return { html, changes };
}

/**
 * Keep text clear of decorative vertical rules and inside the page margins. `rules` are the vertical lines detected in the
 * rendered sample; `diag` its measured text boxes. Moves are translations (and a width trim), so nothing else changes.
 */
export function enforceClearance(html: string, diag: RenderDiag, spec: StyleSpec, rules: VLine[], kinds: Record<string, string>, skip: string[] = []): { html: string; changes: string[] } {
  const changes: string[] = [], m = spec.layout.margins_px, mg = typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m;
  const ruleX = rules.filter((l) => l.thick <= 10 && l.x > 40 && l.x < W / 2).map((l) => l.x + l.thick).sort((a, b) => b - a)[0] ?? 0;
  const left = Math.max(mg.left, ruleX ? ruleX + 28 : 0), right = W - mg.right;
  const all: Record<string, { r: NonNullable<RenderDiag["slots"][string]["rect"]>; furn: boolean }> = {};
  for (const [n, s] of Object.entries(diag.slots)) if (s.rect && s.rect.w >= 4 && s.rect.h >= 4) all[n] = { r: s.rect, furn: false };
  for (const [n, s] of Object.entries(diag.furnStats ?? {})) if (s.rect && s.rect.w >= 4 && s.rect.h >= 4 && !all[n] && !/logo|mark|seal|texture|edge|glow/i.test(n)) all[n] = { r: s.rect, furn: true }; // text furniture (tag, counter, handle) obeys the same clearance
  for (const [name, { r }] of Object.entries(all)) {
    if (skip.includes(name) || (kinds[name] === undefined && !all[name].furn)) continue;
    let dx = 0; const dy = r.y < mg.top ? mg.top - r.y : r.y + r.h > H - mg.bottom ? H - mg.bottom - (r.y + r.h) : 0;
    if (r.x < left) dx = left - r.x;
    else if (r.x + r.w > right) dx = Math.min(0, right - (r.x + r.w));
    const style: Record<string, string> = {}, elW = diag.slots[name]?.elW ?? diag.furnStats?.[name]?.elW ?? r.w;
    if (Math.abs(dx) > 120 || Math.abs(dy) > 120) continue; // a correction this large is a measurement artefact, not a layout fact
    if (r.x + dx + Math.max(r.w, elW) > right + 1) style.width = `${Math.max(80, Math.floor(right - (r.x + dx)))}px`; // box would pass the right margin: narrow it (wraps) instead of overflowing
    if (dx || dy || style.width) { html = editSlot(html, name, { addTranslate: [dx, dy], style }); changes.push(`${name}: kept inside margins${ruleX && dx > 0 ? " and clear of the rule line" : ""} (${Math.round(dx)},${Math.round(dy)})`); }
  }
  return { html, changes };
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
/** Fixed template text that is not a slot (e.g. a baked-in "Swipe →"): find its first word in the render and clear it too. */
export function clearStaticText(html: string, css: string, spec: StyleSpec, rules: VLine[]): { html: string; changes: string[] } {
  const changes: string[] = [], m = spec.layout.margins_px, mg = typeof m === "number" ? { left: m } : m;
  const ruleX = rules.filter((l) => l.thick <= 10 && l.x > 40 && l.x < W / 2).map((l) => l.x + l.thick).sort((a, b) => b - a)[0] ?? 0;
  const left = Math.max(mg.left, ruleX ? ruleX + 28 : 0);
  const re = /<div((?=[^>]*class="[^"]*\bel-)[^>]*)>([^<>{}]{2,40})<\/div>/g; let mm: RegExpExecArray | null; const edits: { open: string; dx: number }[] = [];
  while ((mm = re.exec(html))) {
    const cls = /class="([^"]*)"/.exec(mm[1])?.[1].split(/\s+/).filter((c) => c.startsWith("el-")) ?? [];
    for (const c of cls) {
      const rule = new RegExp(`\\.${c.replace(/[-]/g, "\\-")}\\s*{([^}]*)}`).exec(css)?.[1] ?? ""; const lm = /(?:^|;)\s*left:\s*([^;]+)/.exec(rule); if (!lm) continue;
      const v = lm[1].trim(), x = /^-?[\d.]+px$/.test(v) ? parseFloat(v) : /--m-left/.test(v) ? mg.left : NaN;
      if (Number.isFinite(x) && x < left) { edits.push({ open: `<div${mm[1]}>`, dx: left - x }); break; }
    }
  }
  for (const e of edits) {
    html = editTagTranslate(html, e.open, e.dx); changes.push(`fixed text "${e.open.slice(0, 40)}…" moved ${Math.round(e.dx)}px`);
  }
  return { html, changes };
}
function editTagTranslate(html: string, open: string, dx: number): string {
  const i = html.indexOf(open); if (i < 0) return html;
  const sm = /\sstyle="([^"]*)"/.exec(open), decls = new Map<string, string>();
  for (const d of (sm?.[1] ?? "").split(";")) { const k = d.indexOf(":"); if (k > 0) decls.set(d.slice(0, k).trim(), d.slice(k + 1).trim()); }
  const cur = (decls.get("translate") ?? "0px 0px").split(/\s+/).map(parseFloat); decls.set("translate", `${Math.round(((cur[0] || 0) + dx) * 10) / 10}px ${cur[1] || 0}px`);
  const st = [...decls].map(([k, v]) => `${k}:${v}`).join(";");
  const next = sm ? open.replace(/\sstyle="[^"]*"/, ` style="${st}"`) : open.replace(/>$/, ` style="${st}">`);
  return html.slice(0, i) + next + html.slice(i + open.length);
}

const CONTENT = new Set(["headline", "number", "body", "list", "stamp_text", "maths", "quote", "option", "title", "subhead"]);

/**
 * Ruled/grid paper: horizontal lines drawn as 1px gradient stops vanish at 1080px and in a feed. Make them 2px at the
 * same pitch and lift faint tints, so the paper reads as paper. Idempotent; only touches repeating line gradients.
 */
export function thickenRuledLines(css: string): { css: string; changed: number } {
  let changed = 0;
  const out = css.replace(/(repeating-linear-gradient\(\s*(?:to bottom|180deg)\s*,\s*transparent\s*,\s*)transparent\s+(\d+(?:\.\d+)?)px\s*,\s*((?:color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)))\s+(\d+(?:\.\d+)?)px\s*\)/g, (_m, pre, a, col, b) => {
    const A = parseFloat(a), B = parseFloat(b); if (B - A >= 2) return _m;
    changed++;
    const stronger = String(col).replace(/(\d+)%/, (_x, p) => `${Math.min(30, Math.max(+p, 13))}%`); // faint tints (e.g. 10%) become visible (16%)
    return `${pre}transparent ${A - 1}px, ${stronger} ${A - 1}px, ${stronger} ${B}px)`;
  });
  const out2 = out.replace(/(repeating-linear-gradient\(\s*(?:(?:to bottom|180deg)\s*,\s*)?)((?:color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)))\s+0(?:px)?\s+([\d.]+)px\s*,\s*transparent\s+[\d.]+px\s+([\d.]+)px\s*\)/g, (_m, pre, col, t, pch) => {
    if (parseFloat(t) >= 2) return _m; changed++;
    const stronger = String(col).replace(/(\d+)%/, (_x, p) => `${Math.min(30, Math.max(+p, 13))}%`);
    return `${pre}${stronger} 0 2px, transparent 2px ${pch}px)`;
  });
  return { css: out2, changed };
}

/** Centre-aligned headline/body in a template whose siblings are left-aligned (e.g. an unsampled closer): make it left-aligned. */
export function leftAlignStray(html: string, diag: RenderDiag, kinds: Record<string, string>): { html: string; slots: string[] } {
  const slots: string[] = [];
  for (const [name, s] of Object.entries(diag.slots)) {
    if (!s.rect || !["headline", "number", "body", "title", "stamp_text"].includes(kinds[name] ?? "")) continue;
    const mid = s.rect.x + s.rect.w / 2;
    if (kinds[name] === "stamp_text") { if (Math.abs(mid - W / 2) < 60 && s.rect.x > 240) slots.push(name); continue; }
    if (Math.abs(mid - W / 2) < 45 && s.rect.x > 120 && s.rect.w < W * 0.85) { html = editSlot(html, name, { style: { "text-align": "left", "justify-content": "flex-start" } }); slots.push(name); }
  }
  return { html, slots };
}

/** Pull explicitly anchored slots to the left edge of the text column. */
export function anchorLeft(html: string, diag: RenderDiag, slots: string[], left: number, kinds: Record<string, string> = {}): { html: string; changes: string[] } {
  const changes: string[] = [];
  for (const n of slots) { const r = diag.slots[n]?.rect, pad = kinds[n] === "stamp_text" ? Math.round(r ? r.h * 0.55 : 0) : 0; if (r && Math.abs(r.x - (left + pad)) > 6) { html = editSlot(html, n, { addTranslate: [left + pad - r.x, 0] }); changes.push(`${n}: aligned to the text column`); } }
  return { html, changes };
}

/**
 * A template whose content huddles at the top leaves a dead lower half. Shift the content group (all content slots together,
 * so their relative layout is untouched) down towards the optical centre of the free area. Capped at half the free space so
 * longer real copy still has room.
 */
export function balanceVertical(html: string, diag: RenderDiag, spec: StyleSpec, kinds: Record<string, string>, pitch = 0): { html: string; changes: string[] } {
  const m = spec.layout.margins_px, mg = typeof m === "number" ? { top: m, bottom: m } : m;
  const content = Object.entries(diag.slots).filter(([n, s]) => s.rect && CONTENT.has(kinds[n] ?? ""));
  if (!content.length) return { html, changes: [] };
  // only free-flowing text layouts: boxes drawn around/behind slots (quiz options, cards) must not drift from their slots
  if (content.some(([n]) => kinds[n] === "list")) return { html, changes: [] };
  if ([...html.matchAll(/class="([^"]*\bel-[^"]*)"/g)].some((m) => !/ruled|grid|glow|texture|edge|tape|stamp|paper|noise|scallop|logo|swipe|cta|hairline|line|bg|background/i.test(m[1]))) return { html, changes: [] };
  const top = Math.min(...content.map(([, s]) => s.rect!.y)), bottom = Math.max(...content.map(([, s]) => s.rect!.y + s.rect!.h));
  const furn = Object.entries(diag.furnStats ?? {}).filter(([, s]) => s.rect);
  const above = Math.max(mg.top, ...furn.filter(([, s]) => s.rect!.y + s.rect!.h < top).map(([, s]) => s.rect!.y + s.rect!.h + 40));
  const below = Math.min(H - mg.bottom, ...furn.filter(([, s]) => s.rect!.y > bottom).map(([, s]) => s.rect!.y - 40));
  const regionH = below - above, contentH = bottom - top, free = below - bottom;
  if (regionH < 300 || free < regionH * 0.22) return { html, changes: [] };
  const target = above + (regionH - contentH) * 0.4; let shift = Math.round(Math.min(target - top, free * 0.5, 360));
  if (pitch) shift = Math.floor(shift / pitch) * pitch; // on ruled paper the whole group moves by whole rules, so the baselines stay on them
  if (shift < 40) return { html, changes: [] };
  for (const [n] of content) html = editSlot(html, n, { addTranslate: [0, shift] });
  return { html, changes: [`content moved down ${shift}px to use the empty lower area`] };
}

// ---------------------------------------------------------------------------------------------------------------
// Coherence layer: when one property of a template changes, everything that depends on it must follow.
// Ruled paper is the canonical case: the line pitch and thickness define where text may sit.
// ---------------------------------------------------------------------------------------------------------------
export type Grid = { pitch: number; thick: number; off: number; classes: string[] }; // off = where a rule starts inside each period

/** The horizontal rule grid drawn by the kit's CSS (a repeating line gradient), with the classes that carry it. */
export function rulerGrid(css: string): Grid | null {
  const re = /([^{}]+){([^{}]*repeating-linear-gradient\(\s*(?:to bottom|180deg)\s*,\s*transparent\s*,\s*transparent\s+[\d.]+px\s*,\s*(?:color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s+([\d.]+)px\s*,\s*(?:color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s+([\d.]+)px\s*\)[^{}]*)}/;
  const re2 = /([^{}]+){([^{}]*repeating-linear-gradient\(\s*(?:(?:to bottom|180deg)\s*,\s*)?(?:color-mix\((?:[^()]|\([^()]*\))*\)|var\([^)]*\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s+0(?:px)?\s+([\d.]+)px\s*,\s*transparent\s+[\d.]+px\s+([\d.]+)px\s*\)[^{}]*)}/;
  const m2 = re2.exec(css); if (m2) return { pitch: parseFloat(m2[4]), thick: parseFloat(m2[3]), off: 0, classes: [...m2[1].matchAll(/\.([\w-]+)/g)].map((x) => x[1]) };
  const m = re.exec(css); if (!m) return null;
  const a = parseFloat(m[3]), b = parseFloat(m[4]);
  return { pitch: b, thick: Math.max(1, b - a), off: a, classes: [...m[1].matchAll(/\.([\w-]+)/g)].map((x) => x[1]) };
}
export const usesGrid = (html: string, g: Grid | null): g is Grid => !!g && g.classes.some((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(html)) && g.pitch >= 24;

/** Text on ruled paper takes a line height that is a whole number of rules, so every line sits on its own rule. */
export function ruledLineHeights(html: string, diag: RenderDiag, kinds: Record<string, string>, g: Grid): { html: string; changes: string[] } {
  const changes: string[] = [];
  for (const [name, s] of Object.entries(diag.slots)) {
    if (!["body", "maths"].includes(kinds[name] ?? "") || !s.size || s.size * 1.1 > g.pitch) continue; // running text only; display type keeps its own leading
    const k = 1, lh = Math.round(g.pitch);
    html = editSlot(html, name, { style: { "line-height": `${lh}px` } }); changes.push(`${name}: line height ${lh}px (${k} rule${k > 1 ? "s" : ""})`);
  }
  return { html, changes };
}

/** Shift each text slot so its first baseline sits on a rule (all later lines follow, as the pitch matches). */
export function snapToRuledGrid(html: string, diag: RenderDiag, kinds: Record<string, string>, g: Grid): { html: string; changes: string[] } {
  const changes: string[] = [];
  for (const [name, s] of Object.entries(diag.slots)) {
    if (!["body", "maths"].includes(kinds[name] ?? "") || !s.rect || !s.size || s.size * 1.1 > g.pitch) continue;
    const baseline = s.rect.y + s.rect.h * 0.78, n = Math.round((baseline + 1 - g.off) / g.pitch), target = n * g.pitch + g.off - 1;
    const dy = Math.round(target - baseline);
    if (Math.abs(dy) >= 2 && Math.abs(dy) <= g.pitch / 2 + 1) { html = editSlot(html, name, { addTranslate: [0, dy] }); changes.push(`${name}: baseline snapped to the rule (${dy}px)`); }
  }
  return { html, changes };
}

/**
 * Same furniture, same place, in every template. A furniture element the model left unpositioned (so it falls into the text
 * flow and lands on top of the content) inherits the class and inline style of the same-named element in a template where it
 * is positioned (the cover first, as the look book's reference).
 */
export function harmoniseFurniture(archetypes: { id: string; html: string }[], css: string): string[] {
  const changes: string[] = [];
  const tagRe = (name: string) => new RegExp(`<div((?=[^>]*data-furniture="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")[^>]*)>`);
  const classPositioned = (cls: string) => cls.split(/\s+/).some((c) => c && new RegExp(`\\.${c.replace(/-/g, "\\-")}\\s*{[^}]*position:\\s*absolute`).test(css));
  const positioned = (open: string) => /style="[^"]*position:\s*absolute/.test(open) || /style="[^"]*\b(left|right)\s*:/.test(open) && /style="[^"]*\b(top|bottom)\s*:/.test(open) || classPositioned(/class="([^"]*)"/.exec(open)?.[1] ?? "");
  const names = new Set<string>(); for (const a of archetypes) for (const m of a.html.matchAll(/data-furniture="([^"]+)"/g)) names.add(m[1]);
  for (const name of names) {
    const donorArch = [...archetypes].sort((x, y) => (/cover/i.test(y.id) ? 1 : 0) - (/cover/i.test(x.id) ? 1 : 0)).find((a) => { const m = tagRe(name).exec(a.html); return m && positioned(m[0]) && !/display:\s*none/.test(m[0]); });
    const donor = donorArch && tagRe(name).exec(donorArch.html)?.[0]; if (!donor) continue;
    const pick = (open: string, attr: string) => new RegExp(`\\s${attr}="([^"]*)"`).exec(open)?.[1];
    for (const a of archetypes) {
      if (a === donorArch) continue;
      const m = tagRe(name).exec(a.html); if (!m || positioned(m[0]) || /data-slot=/.test(m[0]) || /display:\s*none/.test(m[0])) continue;
      let open = m[0];
      for (const attr of ["class", "style"]) { const v = pick(donor, attr); if (v === undefined) continue; open = new RegExp(`\\s${attr}="`).test(open) ? open.replace(new RegExp(`\\s${attr}="[^"]*"`), ` ${attr}="${v}"`) : open.replace(/>$/, ` ${attr}="${v}">`); }
      a.html = a.html.slice(0, m.index) + open + a.html.slice(m.index + m[0].length);
      changes.push(`${a.id}: furniture "${name}" positioned like in ${donorArch!.id}`);
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------------------------
// Pixel-level coherence: judge text against what is actually painted behind it, not against the slide background.
// ---------------------------------------------------------------------------------------------------------------
import sharp from "sharp";
import { contrastRatio } from "./autoalign";

const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const cssHex = (css: string) => { const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : ""; };

/** The colour that most pixels in a box are (the backdrop of the text, since glyphs cover few pixels). */
async function dominantColour(png: Buffer, r: { x: number; y: number; w: number; h: number }): Promise<string | null> {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y)), w = Math.min(W - x, Math.ceil(r.w)), h = Math.min(H - y, Math.ceil(r.h));
  if (w < 4 || h < 4) return null;
  const { data } = await sharp(png).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map<number, number>(); for (let i = 0; i < data.length; i += 3) { const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4); bins.set(k, (bins.get(k) ?? 0) + 1); }
  const top = [...bins].sort((a, b) => b[1] - a[1])[0]?.[0]; if (top === undefined) return null;
  return "#" + [(top >> 8) & 15, (top >> 4) & 15, top & 15].map((v) => (v * 17).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Text whose colour cannot be read on the pixels behind it (e.g. paper-coloured text on a paper-coloured box) gets the best palette colour. */
export async function enforceBackdropContrast(html: string, png: Buffer, diag: RenderDiag, spec: StyleSpec, kinds: Record<string, string>): Promise<{ html: string; changes: string[] }> {
  const changes: string[] = [];
  for (const [name, s] of Object.entries(diag.slots)) {
    if (!s.rect || !s.color || kinds[name] === "stamp_text") continue;
    const bg = await dominantColour(png, s.rect), fg = cssHex(s.color); if (!bg || !fg) continue;
    if (contrastRatio(fg, bg) >= 3) continue;
    const best = [...spec.colors].sort((a, b) => contrastRatio(b.hex, bg) - contrastRatio(a.hex, bg))[0];
    html = editSlot(html, name, { style: { color: `var(--c-${best.token})` } }); changes.push(`${name}: text ${fg} unreadable on its backdrop ${bg} → ${best.token}`);
  }
  return { html, changes };
}

/** Text always paints above decorative boxes (option boxes, cards): a slot is never covered by the shape drawn for it. */
export function liftSlots(html: string, kinds: Record<string, string>): string {
  for (const [name, kind] of Object.entries(kinds)) html = editSlot(html, name, { style: { "z-index": "5", ...(/count|counter|tag|cta/i.test(kind + name) ? { "white-space": "nowrap" } : {}) } });
  return html;
}

/** A furniture element that prints the same thing as a slot (tag, counter, handle) on top of it is hidden; the slot carries the copy. */
export function dedupeFurniture(html: string, diag: RenderDiag, kinds: Record<string, string>): { html: string; changes: string[] } {
  const changes: string[] = [];
  for (const c of diag.collisions ?? []) {
    const m = /^(.+?) overlaps (.+)$/.exec(c); if (!m) continue;
    for (const [a, b] of [[m[1], m[2]], [m[2], m[1]]]) if (kinds[a] !== undefined && diag.furnStats?.[b] && kinds[b] === undefined) { html = editSlot(html, b, { style: { visibility: "hidden" } }); changes.push(`furniture "${b}" duplicated slot "${a}": hidden`); }
  }
  return { html, changes };
}

/** Counters and handles built from {{placeholders}} are one line, always. */
export function nowrapPlaceholders(html: string): string {
  return html.replace(/<div((?=[^>]*data-furniture=)[^>]*)>([^<]*\{\{[^<]*)<\/div>/g, (m, attrs, inner) => /white-space:/.test(attrs) ? m : `<div${/\sstyle="/.test(attrs) ? attrs.replace(/\sstyle="/, ' style="white-space:nowrap;') : attrs + ' style="white-space:nowrap"'}>${inner}</div>`);
}

// ---------------------------------------------------------------------------------------------------------------
// Edge elements named by the look book ("Receipt Edge, top/bottom"): drawn in code on every slide where they show.
// ---------------------------------------------------------------------------------------------------------------
const EDGE_WORDS = /\bedges?\b|\btorn\b|serrat|perforat|zig-?zag|scallop/i; // word-bounded: "ledger" must not match "edge"
const lum = (hex: string) => { const c = hexToRgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

/**
 * Adds the look book's edge element (a serrated band on the top and/or bottom of the slide) to every template where it is visible,
 * i.e. where the slide background contrasts with the edge colour (the lightest brand colour). Idempotent.
 */
export function addEdgeBands(archetypes: { id: string; html: string }[], css: string, spec: StyleSpec): { css: string; changes: string[] } {
  const el = spec.elements.find((e) => e.enabled !== false && EDGE_WORDS.test(`${e.id} ${e.description}`) && !/stamp|logo|ruled|paper/i.test(e.id));
  if (!el) return { css, changes: [] };
  const txt = `${el.placement ?? ""} ${el.description} ${spec.guidelines.filter((g) => EDGE_WORDS.test(g.statement)).map((g) => g.statement).join(" ")}`.toLowerCase();
  const top = /top|both|and\/or/.test(txt) || !/bottom/.test(txt), bottom = /bottom|both|and\/or/.test(txt) || !/top/.test(txt);
  const light = [...spec.colors].sort((a, b) => lum(b.hex) - lum(a.hex))[0]; if (!light) return { css, changes: [] };
  const cls = `el-${el.id}`, changes: string[] = [];
  for (const a of archetypes) {
    if (new RegExp(`class="[^"]*\\b${cls}\\b`).test(a.html)) continue;
    const bgTok = /class="slide[^"]*\bbg-([a-z0-9-]+)/.exec(a.html)?.[1], bg = spec.colors.find((c) => c.token === bgTok)?.hex; if (!bg) continue;
    if (contrastRatio(light.hex, bg) < 3) continue; // paper-on-paper: nothing to see
    const bands = `${top ? `<div class="${cls} el-edge-band el-edge-top"></div>` : ""}${bottom ? `<div class="${cls} el-edge-band el-edge-bottom"></div>` : ""}`;
    a.html = a.html.replace(/^(\s*<div[^>]*>)/, `$1${bands}`); changes.push(`${a.id}: ${el.id} added (${[top && "top", bottom && "bottom"].filter(Boolean).join(" + ")})`);
  }
  if (changes.length && !css.includes("/* edge bands */")) {
    const w = 40, n = Math.ceil(W / w), pts: string[] = ["0 0", `${W}px 0`, `${W}px 10px`];
    for (let i = n; i >= 1; i--) pts.push(`${i * w}px 10px`, `${i * w - w / 2}px 28px`);
    pts.push("0 10px");
    css += `\n/* edge bands */\n.el-edge-band{position:absolute;left:0;width:${W}px;height:30px;z-index:6;background-color:var(--c-${light.token});clip-path:polygon(${pts.join(",")});pointer-events:none}\n.el-edge-top{top:0}.el-edge-bottom{bottom:0;transform:scaleY(-1)}\n`;
  }
  return { css, changes };
}
