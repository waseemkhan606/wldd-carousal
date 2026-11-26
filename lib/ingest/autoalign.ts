// Deterministic solver: nudges slot placement/size/tracking/colour/font toward the measured reference by writing inline
// overrides into the archetype HTML. Free (no LLM) and exact where an LLM repair would be noisy.
import type { StyleSpec } from "./spec";
import type { Metrics } from "./measure";
import type { RenderDiag } from "../render/renderer";
import { colorVar, fontVar } from "./kit";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: string, b: string) => { const x = hexRgb(a), y = hexRgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]); };

type Edit = Record<string, string | number | null>;

/** Set/merge inline style declarations and data-* attributes on the element carrying data-slot="name". */
export function editSlot(html: string, name: string, edit: { style?: Record<string, string>; data?: Record<string, string | number>; addTranslate?: [number, number] }): string {
  const re = new RegExp(`<([a-zA-Z0-9]+)((?:\\s[^>]*?)?\\sdata-(?:slot|furniture)=["']${esc(name)}["'][^>]*)>`);
  const m = re.exec(html); if (!m) return html;
  let attrs = m[2];
  const styleM = /\sstyle="([^"]*)"/.exec(attrs);
  const decls = new Map<string, string>();
  for (const d of (styleM?.[1] ?? "").split(";")) { const i = d.indexOf(":"); if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim()); }
  if (edit.addTranslate) {
    const cur = (decls.get("translate") ?? "0px 0px").split(/\s+/).map(parseFloat);
    decls.set("translate", `${Math.round(((cur[0] || 0) + edit.addTranslate[0]) * 10) / 10}px ${Math.round(((cur[1] || 0) + edit.addTranslate[1]) * 10) / 10}px`);
  }
  for (const [k, v] of Object.entries(edit.style ?? {})) decls.set(k, v);
  const style = [...decls].map(([k, v]) => `${k}:${v}`).join(";");
  attrs = styleM ? attrs.replace(/\sstyle="[^"]*"/, ` style="${style}"`) : `${attrs} style="${style}"`;
  for (const [k, v] of Object.entries(edit.data ?? {})) attrs = new RegExp(`\\s${k}="[^"]*"`).test(attrs) ? attrs.replace(new RegExp(`\\s${k}="[^"]*"`), ` ${k}="${v}"`) : `${attrs} ${k}="${v}"`;
  return html.slice(0, m.index) + `<${m[1]}${attrs}>` + html.slice(m.index + m[0].length);
}

/** One solver pass over one archetype. Returns new html and how many corrections were made. */
export function alignArchetype(html: string, metrics: Metrics, diag: RenderDiag, spec: StyleSpec, mode: "shape" | "move" | "hide" = "shape"): { html: string; changes: string[] } {
  const changes: string[] = [];
  if (mode === "hide") for (const f of metrics.absentFurniture ?? []) { html = editSlot(html, f, { style: { display: "none" } }); changes.push(`${f}: hidden (not in this archetype's reference)`); }
  if (mode === "hide") return { html, changes };
  for (const [slot, st] of Object.entries(metrics.slots)) {
    const sd = diag.slots[slot] ?? diag.furnStats?.[slot]; if (!sd || st.nWords < 1) continue;
    const dx = st.got.x - st.ref.x, dy = st.got.y - st.ref.y;
    const style: Record<string, string> = {}, data: Record<string, string | number> = {};
    const locked = new Set((spec.layout.fixed_furniture ?? []).map((f) => f.what));
    if (mode === "move" && locked.has(slot)) continue; // a written rule states where this goes: sample artwork must not override it
    if (mode === "move") {
      // position only: after shape corrections have been applied and re-measured, so the offsets are trustworthy
      if ((Math.abs(dx) > 3 || Math.abs(dy) > 3) && Math.abs(dx) <= 90 && Math.abs(dy) <= 90) { changes.push(`${slot}: move ${Math.round(-dx)},${Math.round(-dy)}px`); html = editSlot(html, slot, { addTranslate: [-dx, -dy] }); }
      continue;
    }
    // font size: median word-height ratio (robust to different line wrapping)
    const sr = st.sizeRatio;
    // guardrail: a measurement that asks for a huge jump is noise (tiny thumbnails, wrapped lines), not design
    const wild = (v: number) => v < 0.7 || v > 1.45;
    if ((sr < 0.93 || sr > 1.07) && !wild(sr)) {
      const cur = sd.size, next = Math.max(12, Math.round(cur / sr));
      style["font-size"] = `${next}px`; data["data-max-size"] = next; data["data-min-size"] = Math.max(10, Math.round(next * 0.55));
      changes.push(`${slot}: font ${cur}→${next}px`);
    }
    // block width (wrapping) for multi-line blocks
    const wr = st.got.w / st.ref.w;
    if (st.lines > 1 && (wr < 0.93 || wr > 1.07) && !wild(wr) && sd.elW) { style["width"] = `${Math.round(sd.elW + (st.ref.w - st.got.w) / (sr < 0.93 || sr > 1.07 ? 1 : 1))}px`; changes.push(`${slot}: width→${style["width"]}`); }
    // tracking from per-word width differences (works for wrapped text), only once the size already matches
    if (sr >= 0.93 && sr <= 1.07 && st.wordTrack !== undefined && Math.abs(st.wordTrack) > 0.35) {
      style["letter-spacing"] = `${Math.round(((sd.ls || 0) + st.wordTrack) * 100) / 100}px`; changes.push(`${slot}: tracking ${st.wordTrack >= 0 ? "+" : ""}${st.wordTrack.toFixed(1)}px/char`);
    }
    // line pitch of multi-line blocks: set the reference pitch directly
    const sizeNow = Number((style["font-size"] ?? "").replace("px", "")) || sd.size;
    if (st.lines > 1 && st.refPitch && st.gotPitch && Math.abs(st.refPitch - st.gotPitch) > 3 && st.refPitch / sizeNow >= 1.0 && st.refPitch / sizeNow <= 1.9) {
      style["line-height"] = `${Math.round(st.refPitch * (sr < 0.93 || sr > 1.07 ? 1 : 1))}px`; changes.push(`${slot}: line-height→${style["line-height"]}`);
    }
    // ink colour -> nearest spec colour variable
    if (st.refColor && st.gotColor && dist(st.refColor, st.gotColor) > 110) {
      const near = [...spec.colors].sort((a, b) => dist(a.hex, st.refColor!) - dist(b.hex, st.refColor!))[0];
      if (near && dist(near.hex, st.refColor) < 120) { style["color"] = `var(${colorVar(near.token)})`; changes.push(`${slot}: colour→${near.token}`); }
    }
    // font family: switch to the spec role whose family matches the reference run
    if (st.refFont) {
      const want = st.refFont.toLowerCase().replace(/[^a-z0-9]/g, "");
      const role = spec.fonts.find((f) => [f.family, f.google_fonts_family ?? ""].some((n) => n.toLowerCase().replace(/[^a-z0-9]/g, "") === want));
      const have = (sd.ff ?? "").toLowerCase().replace(/[^a-z0-9,]/g, "").split(",")[0];
      const known = spec.fonts.some((f) => [f.family, f.google_fonts_family ?? ""].some((n) => have && n.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(have.slice(0, 6))));
      if (role && have && have !== want && !known) { style["font-family"] = `var(${fontVar(role.role)})`; changes.push(`${slot}: font→${role.role}`); }
    }
    if (Object.keys(style).length || Object.keys(data).length) html = editSlot(html, slot, { style, data });
  }
  return { html, changes };
}

/** Replace any hex literal outside :root with the nearest spec colour variable (deterministic, free). */
export function sanitizeHex(css: string, htmls: string[], spec: StyleSpec): { css: string; htmls: string[]; replaced: number } {
  let n = 0;
  const near = (h: string) => { const full = h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h.slice(0, 7); const c = [...spec.colors].sort((a, b) => dist(a.hex, full) - dist(b.hex, full))[0]; return `var(${colorVar(c.token)})`; };
  const sub = (t: string) => t.replace(/(?<!&)#[0-9a-fA-F]{3,8}\b/g, (m) => (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(m) ? (n++, near(m)) : m));
  const rootBlocks: string[] = [];
  const masked = css.replace(/:root\s*{[^}]*}/g, (b) => { rootBlocks.push(b); return `/*ROOT${rootBlocks.length - 1}*/`; });
  const out = sub(masked).replace(/\/\*ROOT(\d+)\*\//g, (_, i) => rootBlocks[Number(i)]);
  return { css: out, htmls: htmls.map((h) => sub(h.replace(/&#\d+;/g, (m) => m))), replaced: n };
}

/**
 * Replace the contents of a furniture element (by data-furniture name) with the real logo image, positioned at the
 * measured box. Deterministic, so the exact brand mark is guaranteed whatever the model drew.
 */
export function swapLogo(html: string, furnName: string, box: { x: number; y: number; w: number; h: number }): string {
  const open = new RegExp(`<([a-zA-Z0-9]+)((?:\\s[^>]*?)?\\sdata-furniture=["']${esc(furnName)}["'][^>]*)>`).exec(html);
  if (!open) return html;
  const tag = open[1], start = open.index + open[0].length;
  // find the matching close tag, honouring nesting of the same tag name
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g"); re.lastIndex = start;
  let depth = 1, end = -1, m: RegExpExecArray | null;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (depth === 0) { end = m.index; break; } }
  if (end < 0) return html;
  if (html.slice(start, end).includes("../assets/logo.png")) return editSlot(html, furnName, { style: logoStyle(box) });
  const swapped = html.slice(0, start) + `<img src="../assets/logo.png" alt="" style="display:block;width:100%;height:100%;object-fit:contain">` + html.slice(end);
  return editSlot(swapped, furnName, { style: logoStyle(box) });
}
const logoStyle = (b: { x: number; y: number; w: number; h: number }) => ({ position: "absolute", left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, background: "none", "border-radius": "0", padding: "0", border: "0", transform: "none" });

/**
 * Written rules beat sample artwork: if a furniture item isn't on the side its rule states ("slide count top-right"),
 * move it to that edge, inside the margins. Deterministic. `diag` is the render diagnostics for this archetype.
 */
export function enforceFurniture(html: string, diag: RenderDiag, spec: StyleSpec): { html: string; changes: string[] } {
  const changes: string[] = [], m = spec.layout.margins_px, mg = typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m;
  for (const msg of diag.furnitureMisplaced ?? []) {
    const name = /^(.+?) should be /.exec(msg)?.[1]; if (!name) continue;
    const pos = spec.layout.fixed_furniture.find((f) => f.what === name)?.position.toLowerCase() ?? "", st = diag.furnStats?.[name], r = st?.rect; if (!r) continue;
    let dx = 0, dy = 0;
    const T = 45; // "top-left" means ON the top-left margin corner, not merely somewhere in the upper-left quadrant
    if (/\bright\b/.test(pos) && (r.x + r.w / 2 < 540 || r.x + r.w < 1080 - mg.right - T)) dx = 1080 - mg.right - (r.x + r.w);
    if (/\bleft\b/.test(pos) && (r.x + r.w / 2 > 540 || r.x > mg.left + T)) dx = mg.left - r.x;
    if (/\btop\b/.test(pos) && (r.y + r.h / 2 > 675 || r.y > mg.top + T)) dy = mg.top - r.y;
    if (/\bbottom\b/.test(pos) && (r.y + r.h / 2 < 675 || r.y + r.h < 1350 - mg.bottom - T)) dy = 1350 - mg.bottom - (r.y + r.h);
    if (dx || dy) { html = editSlot(html, name, { addTranslate: [dx, dy] }); changes.push(`${name}: moved to ${pos} (${Math.round(dx)},${Math.round(dy)}px)`); }
  }
  return { html, changes };
}

const relLum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrastRatio = (a: string, b: string) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/**
 * Text drawn in a colour that cannot be read on the template's own background (e.g. white copy on a paper-white slide)
 * is a model mistake, never a design intent. Re-colour it with the palette token that reads best on that background.
 */
export function fixContrast(html: string, spec: StyleSpec): { html: string; changes: string[] } {
  const changes: string[] = [];
  const bgTok = /class="slide[^"]*\bbg-([a-z0-9-]+)/.exec(html)?.[1];
  const bg = spec.colors.find((c) => c.token === bgTok)?.hex; if (!bg) return { html, changes };
  const best = [...spec.colors].filter((c) => c.token !== bgTok).sort((a, b) => contrastRatio(b.hex, bg) - contrastRatio(a.hex, bg))[0]; if (!best) return { html, changes };
  const out = html.replace(/(data-slot="[^"]+"[^>]*?style="[^"]*?color:)var\(--c-([a-z0-9-]+)\)/g, (m, pre, tok) => {
    const hex = spec.colors.find((c) => c.token === tok)?.hex; if (!hex || contrastRatio(hex, bg) >= 3) return m;
    changes.push(`${tok} on ${bgTok} → ${best.token}`); return `${pre}var(--c-${best.token})`;
  });
  return { html: out, changes };
}

/** Rendered-colour pass: any non-stamp slot whose computed colour is unreadable on the rendered background gets the best-contrast palette colour. */
export function enforceReadable(html: string, diag: RenderDiag, spec: StyleSpec, kinds: Record<string, string>): { html: string; changes: string[] } {
  const changes: string[] = [], hexOf = (css: string) => { const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css); return m ? "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : ""; };
  const bg = hexOf((diag as any).rootBg ?? ""); if (!bg) return { html, changes };
  const best = [...spec.colors].sort((a, b) => contrastRatio(b.hex, bg) - contrastRatio(a.hex, bg))[0];
  for (const [name, st] of Object.entries(diag.slots)) {
    if (kinds[name] === "stamp_text") continue;
    const col = hexOf((st as any).color ?? ""); if (!col || contrastRatio(col, bg) >= 3) continue;
    html = editSlot(html, name, { style: { color: `var(--c-${best.token})` } }); changes.push(`${name}: ${col} unreadable on ${bg} → ${best.token}`);
  }
  return { html, changes };
}
