// Exact geometry of a sample post, measured from the PDF itself (no LLM). Coordinates are in 1080x1350 slide pixels.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { PdfInfo } from "./pdf";

const run = promisify(execFile);
const MAX = 128 * 1024 * 1024;

export type Box = { x: number; y: number; w: number; h: number };
export type GWord = Box & { text: string };
export type GLine = Box & { text: string; color: string; align: "left" | "center" | "right" | "single"; estFontPx: number; font?: string; tracked?: boolean };
export type GShape = Box & { fill?: string; stroke?: string; rotationDeg?: number };
export type PageGeometry = {
  page: number; scale: number; offsetY: number; offsetMethod: "svg-fill" | "full-page" | "unknown";
  words: GWord[]; lines: GLine[]; shapes: GShape[]; referencePng: Buffer; // referencePng: exact 1080x1350 crop of the slide
  frame?: Frame;
};

const num = (s: string) => Number(s);
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
const pct = (s: string) => Math.round((parseFloat(s) / 100) * 255);
const fillHex = (a: string | undefined) => {
  const m = a && /rgb\(\s*([\d.]+)%,\s*([\d.]+)%,\s*([\d.]+)%\)/.exec(a);
  return m ? hex(pct(m[1]), pct(m[2]), pct(m[3])) : undefined;
};

function pathBox(d: string): { x0: number; y0: number; x1: number; y1: number; pts: [number, number][] } | null {
  const n = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  if (!pts.length) return null;
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])), pts };
}

async function tmp(): Promise<string> { return fs.mkdtemp(path.join(os.tmpdir(), "geo-")); }

/** A slide on a look book page, in PDF points. h = w * 1.25 (the 4:5 canvas); `bg` is its background fill. */
export type Frame = { x: number; y: number; w: number; bg?: string };

type RawShape = GShape & { pts: [number, number][] };
async function pageSvgShapes(pdf: string, page: number, dir: string): Promise<RawShape[]> {
  const svgFile = path.join(dir, "p.svg");
  await run("pdftocairo", ["-svg", "-f", String(page), "-l", String(page), pdf, svgFile]);
  const svg = await fs.readFile(svgFile, "utf8");
  const out: RawShape[] = [];
  for (const m of svg.matchAll(/<path\b([^>]*?)\sd="([^"]+)"([^>]*)>/g)) {
    const attrs = m[1] + " " + m[3];
    const fill = fillHex(/fill="([^"]+)"/.exec(attrs)?.[1]); const stroke = fillHex(/stroke="([^"]+)"/.exec(attrs)?.[1]);
    const b = pathBox(m[2]); if (!b) continue;
    out.push({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, fill, stroke, pts: b.pts });
  }
  return out;
}

/**
 * Where the 4:5 slides sit on a look book page. Slides show up as background fills of roughly 4:5 (slightly taller is
 * tolerated: caption margins), possibly several per page (a carousel strip). Full-page 4:5 pages count as one frame.
 */
export async function findFrames(pdf: string, page: number, info: PdfInfo): Promise<Frame[]> {
  const dir = await tmp();
  try {
    const shapes = await pageSvgShapes(pdf, page, dir);
    const cand = shapes.filter((s) => s.fill && s.w >= Math.max(100, info.widthPt * 0.12) && s.w / s.h >= 0.7 && s.w / s.h <= 0.84 && s.x >= -2 && s.y >= -2)
      .sort((a, b) => b.w * b.h - a.w * a.h);
    const frames: Frame[] = [];
    for (const c of cand) {
      if (frames.some((f) => { const ix = Math.min(f.x + f.w, c.x + c.w) - Math.max(f.x, c.x), iy = Math.min(f.y + f.w * 1.25, c.y + c.h) - Math.max(f.y, c.y); return ix > 0 && iy > 0 && ix * iy > 0.5 * Math.min(f.w * f.w * 1.25, c.w * c.h); })) continue;
      frames.push({ x: Math.max(0, c.x), y: Math.max(0, c.y), w: c.w, bg: c.fill });
    }
    if (!frames.length && Math.abs(info.heightPt - info.widthPt * 1.25) < 3) frames.push({ x: 0, y: 0, w: info.widthPt });
    return frames.sort((a, b) => a.y - b.y || a.x - b.x);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Assign one frame per archetype sharing a page: background colour first, then role (cover first, closer last). */
export function pickFrames(frames: Frame[], archs: { id: string; purpose: string; bg?: string }[]): Map<string, Frame> {
  const out = new Map<string, Frame>(), used = new Set<Frame>();
  const dist = (a?: string, b?: string) => (a && b ? rgbOf(a).reduce((s, v, i) => s + Math.abs(v - rgbOf(b)[i]), 0) : 999);
  for (const a of archs) {
    const free = frames.filter((f) => !used.has(f));
    if (!free.length) break;
    const near = free.filter((f) => dist(f.bg, a.bg) < 45);
    const pool = near.length ? near : free;
    const pick = /clos|cta|outro|last|end/i.test(a.purpose + a.id) ? pool[pool.length - 1] : pool[0];
    out.set(a.id, pick); used.add(pick);
  }
  return out;
}

export async function extractGeometry(pdf: string, page: number, info: PdfInfo, frame?: Frame): Promise<PageGeometry | null> {
  if (!frame) { const fr = await findFrames(pdf, page, info); if (!fr.length) return null; frame = fr[0]; }
  const scale = 1080 / frame.w;
  const offsetPt = frame.y, offsetX = frame.x, method: PageGeometry["offsetMethod"] = "svg-fill";
  const dir = await tmp();
  try {
    const shapesPt = await pageSvgShapes(pdf, page, dir);
    // 2) words/lines from pdftotext bbox layout
    const xml = (await run("pdftotext", ["-f", String(page), "-l", String(page), "-bbox-layout", pdf, "-"], { maxBuffer: MAX })).stdout;
    const toBox = (a: string): Box => { const g = (k: string) => num(new RegExp(`${k}="([^"]+)"`).exec(a)![1]); const x0 = g("xMin"), y0 = g("yMin"), x1 = g("xMax"), y1 = g("yMax"); return { x: (x0 - offsetX) * scale, y: (y0 - offsetPt) * scale, w: (x1 - x0) * scale, h: (y1 - y0) * scale }; };
    const inSlide = (b: Box) => b.y >= -4 && b.y + b.h <= 1354 && b.x >= -4 && b.x + b.w <= 1084;
    const words: GWord[] = [], linesRaw: { box: Box; words: GWord[] }[] = [];
    for (const lm of xml.matchAll(/<line ([^>]*)>([\s\S]*?)<\/line>/g)) {
      const lb = toBox(lm[1]); if (!inSlide(lb)) continue;
      const ws: GWord[] = [...lm[2].matchAll(/<word ([^>]*)>([^<]*)<\/word>/g)].map((w) => ({ ...toBox(w[1]), text: decode(w[2]) }));
      if (!ws.length) continue;
      words.push(...ws); linesRaw.push({ box: lb, words: ws });
    }
    // 3) the exact reference crop, 1080 wide
    const dpi = (72 * 1080) / frame.w;
    const outBase = path.join(dir, "ref");
    await run("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", "-singlefile", "-x", String(Math.round(offsetX * (dpi / 72))), "-y", String(Math.round(offsetPt * (dpi / 72))), "-W", "1080", "-H", "1350", pdf, outBase], { maxBuffer: MAX });
    const refPng = await sharp(await fs.readFile(outBase + ".png")).resize(1080, 1350, { fit: "fill" }).png().toBuffer();
    // 4) ink colour + alignment per line
    const raw = await sharp(refPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lines: GLine[] = linesRaw.map(({ box, words: ws }) => ({ ...box, text: ws.map((w) => w.text).join(" "), color: inkColor(raw.data, raw.info.width, box), align: "single" as const, estFontPx: Math.round(box.h / 1.2) }));
    markAlignment(lines);
    await attachFonts(pdf, page, offsetPt, offsetX, scale, lines);
    // 5) vector shapes inside the slide that aren't the full background
    const shapes: GShape[] = shapesPt.map((s) => {
      const box = { x: (s.x - offsetX) * scale, y: (s.y - offsetPt) * scale, w: s.w * scale, h: s.h * scale };
      return { ...box, fill: s.fill, stroke: s.stroke, rotationDeg: rotation(s.pts) };
    }).filter((s) => s.w > 3 && s.h > 3 && s.y > -4 && s.y + s.h < 1354 && !(s.w > 1060 && s.h > 1300) && (s.fill || s.stroke));
    return { page, scale, offsetY: offsetPt, offsetMethod: method, words, lines, shapes: shapes.slice(0, 40), referencePng: refPng, frame };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");

/** Slight tilt of a polygon from its first long edge; only reported when clearly non-axis-aligned. */
function rotation(pts: [number, number][]): number | undefined {
  if (pts.length < 4) return undefined;
  for (let i = 0; i + 1 < pts.length; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    if (Math.hypot(dx, dy) > 20) {
      let a = (Math.atan2(dy, dx) * 180) / Math.PI; a = ((a + 45) % 90 + 90) % 90 - 45;
      return Math.abs(a) > 0.7 ? Math.round(a * 10) / 10 : undefined;
    }
  }
}

/** Most frequent colour inside the box = background; most frequent far-from-background colour = ink. */
export function inkColor(data: Buffer, W: number, b: Box): string {
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y)), x1 = Math.min(W, Math.ceil(b.x + b.w)), y1 = Math.min(1350, Math.ceil(b.y + b.h));
  const q = (v: number) => v >> 3;
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 3, k = (q(data[o]) << 10) | (q(data[o + 1]) << 5) | q(data[o + 2]);
    const e = hist.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += data[o]; e.g += data[o + 1]; e.b += data[o + 2]; hist.set(k, e);
  }
  const all = [...hist.values()].sort((a, b) => b.n - a.n);
  if (!all.length) return "#000000";
  const bg = all[0], dist = (e: typeof bg) => Math.abs(e.r / e.n - bg.r / bg.n) + Math.abs(e.g / e.n - bg.g / bg.n) + Math.abs(e.b / e.n - bg.b / bg.n);
  const ink = all.find((e) => dist(e) > 120) ?? all[0];
  return hex(ink.r / ink.n, ink.g / ink.n, ink.b / ink.n);
}

/** Alignment per line from its block neighbours (lines stacked within 2.5 line-heights share a block). */
function markAlignment(lines: GLine[]) {
  const sorted = [...lines].sort((a, b) => a.y - b.y);
  let block: GLine[] = [];
  const flush = () => {
    if (block.length >= 2) {
      const L = block.map((l) => l.x), C = block.map((l) => l.x + l.w / 2), R = block.map((l) => l.x + l.w);
      const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
      const best = ([["left", spread(L)], ["center", spread(C)], ["right", spread(R)]] as ["left" | "center" | "right", number][]).sort((a, b) => a[1] - b[1])[0];
      for (const l of block) l.align = best[1] < 12 ? best[0] : "left";
    } else if (block.length === 1) {
      const l = block[0], cx = l.x + l.w / 2;
      l.align = Math.abs(cx - 540) < 24 ? "center" : l.x + l.w > 1080 - 120 && l.x > 540 ? "right" : "left";
    }
    block = [];
  };
  for (const l of sorted) {
    const last = block[block.length - 1];
    if (last && l.y - (last.y + last.h) > Math.max(last.h, l.h) * 1.5) flush();
    block.push(l);
  }
  flush();
}

/** Compact, token-cheap description for prompts. */
export function describeGeometry(g: PageGeometry): string {
  const lines = g.lines.map((l) => `"${l.text}" x=${Math.round(l.x)} y=${Math.round(l.y)} w=${Math.round(l.w)} h=${Math.round(l.h)} ${l.font ? "font " + l.font + " " : "~font "}${l.estFontPx}px ${l.align} ink ${l.color}${l.tracked ? " letter-spaced" : ""}`);
  const shapes = g.shapes.map((s) => `${s.fill ? "fill " + s.fill : ""}${s.stroke ? " stroke " + s.stroke : ""} x=${Math.round(s.x)} y=${Math.round(s.y)} w=${Math.round(s.w)} h=${Math.round(s.h)}${s.rotationDeg ? " rot " + s.rotationDeg + "deg" : ""}`.trim());
  return `Slide coordinates are px in a 1080x1350 canvas (origin top-left), measured from the PDF vector data (exact).\nText lines:\n${lines.join("\n")}\nVector shapes (non-glyph):\n${shapes.join("\n")}`;
}


const normFam = (f: string) => f.replace(/^[A-Z]{6}\+/, "").replace(/-(Regular|Bold|Italic|Medium|Light|Black|SemiBold|\d+pt\w*)$/i, "");

/** Exact font family / size / ink from pdftohtml runs, matched to each line by centre containment. */
async function attachFonts(pdf: string, page: number, offsetPt: number, offsetX: number, scale: number, lines: GLine[]) {
  try {
    const xml = (await run("pdftohtml", ["-xml", "-stdout", "-zoom", "1", "-i", "-f", String(page), "-l", String(page), pdf], { maxBuffer: MAX })).stdout;
    const specs = new Map<string, { size: number; family: string; color: string }>();
    for (const m of xml.matchAll(/<fontspec id="(\d+)" size="(\d+)" family="([^"]*)" color="(#[0-9a-fA-F]{6})"/g)) specs.set(m[1], { size: Number(m[2]), family: m[3], color: m[4].toUpperCase() });
    const runs = [...xml.matchAll(/<text top="(-?\d+)" left="(-?\d+)" width="(\d+)" height="(\d+)" font="(\d+)">([\s\S]*?)<\/text>/g)].map((m) => {
      const f = specs.get(m[5]); return f && { x: (Number(m[2]) - offsetX) * scale, y: (Number(m[1]) - offsetPt) * scale, w: Number(m[3]) * scale, h: Number(m[4]) * scale, f, text: m[6].replace(/<[^>]+>/g, "") };
    }).filter(Boolean) as { x: number; y: number; w: number; h: number; f: { size: number; family: string; color: string }; text: string }[];
    for (const l of lines) {
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      const r = runs.filter((u) => cx >= u.x - 6 && cx <= u.x + u.w + 6 && cy >= u.y - 6 && cy <= u.y + u.h + 6).sort((a, b) => b.text.replace(/\s/g, "").length - a.text.replace(/\s/g, "").length)[0]
        ?? runs.filter((u) => Math.abs(u.y - l.y) < l.h && u.x < l.x + l.w && u.x + u.w > l.x)[0];
      if (!r) continue;
      l.font = normFam(r.f.family); l.estFontPx = Math.round(r.f.size * scale); l.color = r.f.color;
      l.tracked = /^(\S ){3,}/.test(r.text.trim());
    }
  } catch { /* fonts are an enhancement; geometry stands without them */ }
}
