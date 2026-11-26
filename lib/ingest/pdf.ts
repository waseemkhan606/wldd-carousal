// Thin wrappers over poppler-utils. No brand knowledge here.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const MAX = 64 * 1024 * 1024;

export class PdfError extends Error {
  constructor(public code: "POPPLER_MISSING" | "BROKEN_PDF", msg: string) {
    super(msg);
  }
}

async function poppler(bin: string, args: string[], encoding: BufferEncoding | "buffer" = "utf8") {
  try {
    const r = await run(bin, args, { maxBuffer: MAX, encoding: encoding as BufferEncoding });
    return r.stdout as string;
  } catch (e: any) {
    if (e.code === "ENOENT") throw new PdfError("POPPLER_MISSING", `${bin} not found. Install poppler (brew install poppler / apt install poppler-utils).`);
    throw new PdfError("BROKEN_PDF", `${bin} failed: ${String(e.stderr || e.message).slice(0, 300)}`);
  }
}

export type PdfInfo = { pages: number; widthPt: number; heightPt: number; title?: string };

export async function pdfInfo(pdf: string): Promise<PdfInfo> {
  const out = await poppler("pdfinfo", [pdf]);
  const pages = Number(/^Pages:\s+(\d+)/m.exec(out)?.[1]);
  const size = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(out);
  if (!pages || !size) throw new PdfError("BROKEN_PDF", "Could not read page count/size. Is this a valid PDF?");
  return { pages, widthPt: Number(size[1]), heightPt: Number(size[2]), title: /^Title:\s+(.+)$/m.exec(out)?.[1] };
}

/** Text of every page (layout-preserving). Index 0 = page 1. */
export async function pageTexts(pdf: string, pages: number): Promise<string[]> {
  const out = await poppler("pdftotext", ["-layout", pdf, "-"]);
  const parts = out.split("\f");
  const texts = Array.from({ length: pages }, (_, i) => (parts[i] ?? "").trim());
  return texts;
}

export type RawFont = { name: string; type: string; embedded: boolean; pages: number[] };

export async function rawFonts(pdf: string, pages: number): Promise<RawFont[]> {
  // per-page listing so we know which pages each font appears on
  const byName = new Map<string, RawFont>();
  for (let p = 1; p <= pages; p++) {
    const out = await poppler("pdffonts", ["-f", String(p), "-l", String(p), pdf]);
    for (const line of out.split("\n").slice(2)) {
      const m = /^(\S+)\s+(Type 3|Type 1C?|CID Type 0C?|CID TrueType|TrueType|OpenType|Type 1)\s/.exec(line);
      if (!m) continue;
      const f = byName.get(m[1]) ?? { name: m[1], type: m[2], embedded: /\syes\s/.test(line), pages: [] };
      if (!f.pages.includes(p)) f.pages.push(p);
      byName.set(m[1], f);
    }
  }
  return [...byName.values()];
}

/** Render pages to PNG at the given dpi. Returns file paths in page order. */
export async function renderPages(pdf: string, outDir: string, dpi: number, prefix = "p"): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  await poppler("pdftoppm", ["-r", String(dpi), "-png", pdf, path.join(outDir, prefix)]);
  const files = (await fs.readdir(outDir)).filter((f) => f.startsWith(prefix + "-") && f.endsWith(".png"));
  files.sort((a, b) => Number(a.match(/(\d+)\.png$/)![1]) - Number(b.match(/(\d+)\.png$/)![1]));
  return files.map((f) => path.join(outDir, f));
}

/** Render one page as raw PPM bytes (cheap to parse, no image lib needed). */
export async function renderPagePpm(pdf: string, page: number, dpi: number): Promise<Buffer> {
  try {
    const r = await run("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), pdf], { maxBuffer: MAX, encoding: "buffer" });
    return r.stdout as unknown as Buffer;
  } catch (e: any) {
    throw new PdfError("BROKEN_PDF", `pdftoppm failed on page ${page}: ${e.message}`);
  }
}

export type PdfImage = { page: number; width: number; height: number; type: string };
export async function listImages(pdf: string): Promise<PdfImage[]> {
  const out = await poppler("pdfimages", ["-list", pdf]);
  return out.split("\n").slice(2).flatMap((l) => {
    const c = l.trim().split(/\s+/);
    if (c.length < 5) return [];
    return [{ page: Number(c[0]), width: Number(c[3]), height: Number(c[4]), type: c[2] }];
  });
}

/** Crop a region from a high-res render. Box in 0..1 page fractions. */
export async function cropPage(pdf: string, page: number, box: { x: number; y: number; w: number; h: number }, info: PdfInfo, dpi: number, outPng: string) {
  const scale = dpi / 72;
  const W = Math.round(info.widthPt * scale), H = Math.round(info.heightPt * scale);
  const args = ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", "-singlefile",
    "-x", String(Math.round(box.x * W)), "-y", String(Math.round(box.y * H)),
    "-W", String(Math.max(1, Math.round(box.w * W))), "-H", String(Math.max(1, Math.round(box.h * H))), pdf, outPng.replace(/\.png$/, "")];
  await poppler("pdftoppm", args);
}
