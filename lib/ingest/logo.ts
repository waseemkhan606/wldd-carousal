// The brand mark must be the real one, not the model's redrawing. Find the logo blob in its furniture corner of a
// sample slide (excluding text), crop it from a 4x render of the PDF, and give it a clean alpha channel.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Frame, PageGeometry } from "./geometry";

const run = promisify(execFile);
export type LogoBox = { x: number; y: number; w: number; h: number };

const dist = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** Largest compact non-background, non-text blob in the corner named by `position` ("bottom-right", ...). */
export async function findLogoBox(geo: PageGeometry, position: string): Promise<LogoBox | null> {
  const p = position.toLowerCase();
  const RW = 300, RH = 260;
  const x0 = /left/.test(p) ? 0 : 1080 - RW, y0 = /top/.test(p) ? 0 : 1350 - RH;
  const { data, info } = await sharp(geo.referencePng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const at = (x: number, y: number) => ((y0 + y) * W + (x0 + x)) * 3;
  // background = most common quantised colour in the region
  const hist = new Map<number, { n: number; c: number[] }>();
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) { const o = at(x, y), k = (data[o] >> 4) << 8 | (data[o + 1] >> 4) << 4 | data[o + 2] >> 4; const e = hist.get(k) ?? { n: 0, c: [data[o], data[o + 1], data[o + 2]] }; e.n++; hist.set(k, e); }
  const bg = [...hist.values()].sort((a, b) => b.n - a.n)[0].c;
  const inText = (x: number, y: number) => geo.lines.some((l) => x0 + x >= l.x - 6 && x0 + x <= l.x + l.w + 6 && y0 + y >= l.y - 6 && y0 + y <= l.y + l.h + 6);
  const mask = new Uint8Array(RW * RH);
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) { const o = at(x, y); if (dist([data[o], data[o + 1], data[o + 2]], bg) > 110 && !inText(x, y)) mask[y * RW + x] = 1; }
  const seen = new Uint8Array(RW * RH); let best: { area: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const q = [s]; seen[s] = 1; let area = 0, bx0 = RW, by0 = RH, bx1 = 0, by1 = 0;
    while (q.length) {
      const i = q.pop()!, x = i % RW, y = (i / RW) | 0; area++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= RW || ny >= RH) continue; const j = ny * RW + nx; if (mask[j] && !seen[j]) { seen[j] = 1; q.push(j); } }
    }
    if (!best || area > best.area) best = { area, x0: bx0, y0: by0, x1: bx1, y1: by1 };
  }
  if (process.env.LOGO_DEBUG) console.error("logo blob", best);
  if (!best) return null;
  const w = best.x1 - best.x0 + 1, h = best.y1 - best.y0 + 1, asp = w / h;
  if (w < 28 || h < 28 || w > 260 || h > 260 || asp < 0.55 || asp > 1.8 || best.area / (w * h) < 0.2) return null;
  return { x: x0 + best.x0, y: y0 + best.y0, w, h };
}

/** Crops the box (slide px) from a 4x render and writes an RGBA PNG whose background has been made transparent. */
export async function cropLogo(pdf: string, geo: PageGeometry, frame: Frame, box: LogoBox, outPng: string): Promise<void> {
  const dpi = ((72 * 1080) / frame.w) * 4, k = dpi / 72, pad = 3;
  const base = outPng.replace(/\.png$/, ".raw");
  const rx = Math.max(0, Math.round((frame.x * k) + (box.x - pad) * 4)), ry = Math.max(0, Math.round((frame.y * k) + (box.y - pad) * 4));
  const W = (box.w + pad * 2) * 4, H = (box.h + pad * 2) * 4;
  await fs.mkdir(path.dirname(outPng), { recursive: true });
  await run("pdftoppm", ["-r", String(dpi), "-f", String(geo.page), "-l", String(geo.page), "-png", "-singlefile", "-x", String(rx), "-y", String(ry), "-W", String(W), "-H", String(H), pdf, base]);
  const { data, info } = await sharp(base + ".png").removeAlpha().raw().toBuffer({ resolveWithObject: true });
  await fs.unlink(base + ".png").catch(() => {});
  const w = info.width, h = info.height, px = (i: number) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const bg = px(0), isBg = (i: number) => dist(px(i), bg) <= 85; // tolerant: faint ruling under the logo must not survive as "logo"
  // flood fill from the border over background-like pixels = outside; everything else (including holes inside) is logo
  const outside = new Uint8Array(w * h), q: number[] = [];
  const push = (x: number, y: number) => { const i = y * w + x; if (!outside[i] && isBg(i)) { outside[i] = 1; q.push(i); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); } for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (q.length) { const i = q.pop()!, x = i % w, y = (i / w) | 0; if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1); }
  const alpha = Buffer.alloc(w * h); for (let i = 0; i < w * h; i++) alpha[i] = outside[i] ? 0 : 255;
  const blurred = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } }).blur(1.1).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  const stride = blurred.info.channels, soft = blurred.data; // do not assume 1 channel
  const rgba = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = soft[i * stride]; }
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outPng);
}
