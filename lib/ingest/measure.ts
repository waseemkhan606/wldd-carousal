// Deterministic fidelity: compare a rendered archetype to the exact reference crop. No LLM involved.
import sharp from "sharp";
import type { PageGeometry, Box } from "./geometry";
import { inkColor } from "./geometry";
import type { RenderDiag } from "../render/renderer";

export type Metrics = {
  pixel: number; ssim: number; layout: number; matched: number; posErrPx: number; sizeRatio: number;
  score: number; issues: string[];
  slots: Record<string, SlotStat>;
  absentFurniture: string[]; // furniture in the template whose text appears nowhere in this archetype's own reference
};
export type SlotStat = { ref: Box; got: Box; nWords: number; chars: number; sizeRatio: number; lines: number; refPitch?: number; gotPitch?: number; wordTrack?: number; refColor?: string; gotColor?: string; refFont?: string; tracked?: boolean; align?: string };

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// currency signs are dropped: PDFs often split "₹36,500" into "₹" + "36,500" (different font runs) while the DOM keeps one word
// numbers collapse to "#": reference counters read "04 / 05" while ours read "3/7"
const norm = (t: string) => t.toLowerCase().replace(/\p{N}+([.,]\p{N}+)*/gu, "#").replace(/[^\p{L}#%]/gu, "");

async function small(png: Buffer, w: number, h: number) {
  return sharp(png).removeAlpha().resize(w, h, { fit: "fill" }).raw().toBuffer();
}

/** Mean-abs colour difference + windowed SSIM on luminance, plus the 3x3 cells that differ most. */
export async function pixelCompare(render: Buffer, ref: Buffer) {
  const W = 270, H = 338;
  const [a, b] = await Promise.all([small(render, W, H), small(ref, W, H)]);
  let abs = 0; const cell = new Float64Array(9), cellN = new Float64Array(9);
  const lum = (d: Buffer, i: number) => 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2];
  const la = new Float64Array(W * H), lb = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const d = (Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2])) / (3 * 255);
    abs += d; const x = i % W, y = (i / W) | 0, c = Math.min(2, (y * 3 / H) | 0) * 3 + Math.min(2, (x * 3 / W) | 0);
    cell[c] += d; cellN[c]++;
    la[i] = lum(a, i); lb[i] = lum(b, i);
  }
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, win = 8; let ss = 0, n = 0;
  for (let y = 0; y + win <= H; y += 4) for (let x = 0; x + win <= W; x += 4) {
    let ma = 0, mb = 0; for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { ma += la[(y + j) * W + x + i]; mb += lb[(y + j) * W + x + i]; }
    ma /= win * win; mb /= win * win; let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < win; j++) for (let i = 0; i < win; i++) { const p = la[(y + j) * W + x + i] - ma, q = lb[(y + j) * W + x + i] - mb; va += p * p; vb += q * q; cov += p * q; }
    va /= win * win - 1; vb /= win * win - 1; cov /= win * win - 1;
    ss += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  const meanAbs = abs / (W * H), ssim = ss / n;
  const names = ["top-left", "top", "top-right", "left", "centre", "right", "bottom-left", "bottom", "bottom-right"];
  const hot = [...cell].map((v, i) => ({ r: names[i], d: v / cellN[i] })).sort((x, y) => y.d - x.d).slice(0, 2).filter((h) => h.d > 0.1);
  const pixel = 100 * (0.6 * clamp(ssim) + 0.4 * clamp(1 - meanAbs * 3));
  return { pixel, ssim, meanAbs, hot };
}

const r0 = (n: number) => Math.round(n);
const union = (bs: Box[]): Box => { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)), x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };

export async function measure(render: Buffer, diag: RenderDiag, geo: PageGeometry): Promise<Metrics> {
  const px = await pixelCompare(render, geo.referencePng);
  const issues: string[] = [];
  const rendered = (diag.words ?? []).map((w) => ({ ...w, k: norm(w.t) })).filter((w) => w.k);
  const used = new Set<number>(), pairs: { ref: typeof geo.words[0]; got: typeof rendered[0] }[] = [];
  const refWords = geo.words.filter((w) => norm(w.text));
  for (const rw of refWords) {
    const k = norm(rw.text); let best = -1, bd = Infinity;
    rendered.forEach((g, i) => { if (used.has(i) || g.k !== k) return; const d = Math.hypot(g.x + g.w / 2 - (rw.x + rw.w / 2), g.y + g.h / 2 - (rw.y + rw.h / 2)); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { used.add(best); pairs.push({ ref: rw, got: rendered[best] }); }
  }
  const matched = refWords.length ? pairs.length / refWords.length : 0;
  const posErrs = pairs.map((p) => Math.hypot(p.got.x + p.got.w / 2 - (p.ref.x + p.ref.w / 2), p.got.y + p.got.h / 2 - (p.ref.y + p.ref.h / 2)));
  const ratios = pairs.filter((p) => p.ref.h > 4).map((p) => p.got.h / p.ref.h);
  const posErr = median(posErrs), ratio = ratios.length ? median(ratios) : 1;
  const layout = 100 * (0.3 * matched + 0.4 * clamp(1 - posErr / 100) + 0.3 * clamp(1 - Math.abs(Math.log(ratio)) / 0.5));

  // actionable per-slot issues
  const bySlot = new Map<string, typeof pairs>();
  for (const p of pairs) bySlot.set(p.got.n, [...(bySlot.get(p.got.n) ?? []), p]);
  const slots: Record<string, SlotStat> = {};
  const raw = await sharp(render).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [slot, ps] of bySlot) {
    const R = union(ps.map((p) => p.ref)), G = union(ps.map((p) => p.got));
    const dx = G.x - R.x, dy = G.y - R.y, wr = G.w / R.w, hr = G.h / R.h;
    const refLines = geo.lines.filter((l) => ps.some((p) => p.ref.y >= l.y - 2 && p.ref.y <= l.y + l.h));
    const align = refLines[0]?.align ?? "left";
    const parts: string[] = [];
    if (Math.abs(dx) > 14 || Math.abs(dy) > 14) parts.push(`move by dx=${r0(-dx)}px, dy=${r0(-dy)}px`);
    if (wr < 0.85 || wr > 1.15) parts.push(`text block width should be ${r0(R.w)}px (is ${r0(G.w)}px)`);
    if (hr < 0.85 || hr > 1.15) parts.push(`text block height should be ${r0(R.h)}px (is ${r0(G.h)}px); font size roughly ×${(1 / Math.sqrt(hr * wr > 0 ? hr : 1)).toFixed(2)}`);
    // colour of the first matched line
    const l0 = refLines[0];
    const wRatios = ps.filter((p) => p.ref.h > 4).map((p) => p.got.h / p.ref.h);
    const pitchOf = (ys: number[]) => { const c: number[] = []; for (const y of [...ys].sort((a, b) => a - b)) if (!c.length || y - c[c.length - 1] > 0.4 * (R.h / Math.max(1, refLines.length || 1))) c.push(y); const d = c.slice(1).map((v, i) => v - c[i]); return d.length ? median(d) : undefined; };
    const refPitch = pitchOf(ps.map((p) => p.ref.y + p.ref.h / 2)), gotPitch = pitchOf(ps.map((p) => p.got.y + p.got.h / 2));
    // per-character width difference over matched words of similar height (independent of line wrapping)
    const tr = ps.filter((p) => p.got.t.length >= 3 && p.ref.h > 4 && p.got.h / p.ref.h > 0.88 && p.got.h / p.ref.h < 1.12).map((p) => (p.ref.w - p.got.w) / p.got.t.length);
    slots[slot] = { refPitch, gotPitch, wordTrack: tr.length >= 2 ? median(tr) : undefined, ref: R, got: G, nWords: ps.length, chars: ps.reduce((n, p) => n + p.got.t.length, 0) + Math.max(0, ps.length - 1), sizeRatio: wRatios.length ? median(wRatios) : 1, lines: refLines.length || 1, refColor: l0?.color, gotColor: l0 ? inkColor(raw.data, raw.info.width, G) : undefined, refFont: l0?.font, tracked: l0?.tracked, align };
    if (l0) { const mine = inkColor(raw.data, raw.info.width, G); const dist = (c1: string, c2: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(c1.slice(i, i + 2), 16) - parseInt(c2.slice(i, i + 2), 16)), 0); if (dist(mine, l0.color) > 110) parts.push(`text colour should be about ${l0.color} (renders ${mine})`); }
    if (parts.length) issues.push(`slot "${slot}": reference block "${ps.slice(0, 5).map((p) => p.ref.text).join(" ")}…" is at x=${r0(R.x)}, y=${r0(R.y)}, w=${r0(R.w)}, h=${r0(R.h)}, ${align}-aligned; fix: ${parts.join("; ")}.`);
  }
  const missing = geo.lines.filter((l) => !pairs.some((p) => p.ref.y >= l.y - 2 && p.ref.y <= l.y + l.h));
  for (const l of missing.slice(0, 5)) issues.push(`reference text "${l.text}" (x=${r0(l.x)}, y=${r0(l.y)}, ${l.estFontPx}px, ink ${l.color}) is not present in your render: add the slot/furniture or use this exact text in sample_slots.`);
  for (const h of px.hot) issues.push(`largest visual difference is in the ${h.r} region (${(h.d * 100).toFixed(0)}% mean colour difference): compare backgrounds, decoration and shapes there.`);
  const score = 0.5 * layout + 0.5 * px.pixel;
  const usedKeys = new Set([...used].map((i) => rendered[i].n));
  const absentFurniture = matched >= 0.5 ? (diag.furniture ?? []).filter((f) => rendered.some((w) => w.n === f) && !usedKeys.has(f)) : [];
  return { pixel: px.pixel, ssim: px.ssim, layout, matched, posErrPx: posErr, sizeRatio: ratio, score, issues, slots, absentFurniture };
}
