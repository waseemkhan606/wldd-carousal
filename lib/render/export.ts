import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { carouselCost, lookbookCost } from "../llm/usage";
import { getFx } from "../llm/pricing";
import { db } from "../db";
import type { CarouselRow } from "../db/carousels";
import type { CopyData } from "../db/carousels";

/**
 * PDF: one page per slide at exactly 1080x1350, each slide's PNG embedded losslessly. Decision (see DECISIONS.md):
 * embedding the verified PNG guarantees the PDF page is pixel-identical to the PNG, which a re-print of the DOM
 * through page.pdf() cannot (masks/filters/fonts print differently). Cost: text in the PDF is not selectable.
 */
export async function buildPdf(pngPaths: string[], out: string) {
  const pdf = await PDFDocument.create();
  for (const p of pngPaths) {
    const img = await pdf.embedPng(await fs.readFile(p));
    const page = pdf.addPage([1080, 1350]);
    page.drawImage(img, { x: 0, y: 0, width: 1080, height: 1350 });
  }
  await fs.writeFile(out, await pdf.save());
}

export async function buildZip(files: { name: string; path: string }[], out: string) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, await fs.readFile(f.path));
  await fs.writeFile(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

export function captionsTxt(c: CopyData): string {
  const src = c.sources_note?.trim() ? `\n\nSources and assumptions: ${c.sources_note.trim()}` : ""; // the look book asks for sources in the caption
  const block = (title: string, cap: { text: string; hashtags: string[] }) => `${title}\n${"=".repeat(title.length)}\n${cap.text.trim()}${src}\n\n${cap.hashtags.join(" ")}\n`;
  return [block("INSTAGRAM", c.captions.instagram), block("LINKEDIN", c.captions.linkedin), c.sources_note ? `NOTES / ASSUMPTIONS\n===================\n${c.sources_note.trim()}\n` : ""].filter(Boolean).join("\n");
}

export function costReport(carousel: CarouselRow) {
  const fx = getFx();
  const cc = carouselCost(carousel.id), ic = lookbookCost(carousel.lookbook_id);
  const n = (db().prepare("SELECT COUNT(*) n FROM carousels WHERE lookbook_id=?").get(carousel.lookbook_id) as { n: number }).n || 1;
  return {
    carousel: { id: carousel.id, rows: cc.rows, usd: cc.usd, inr: cc.inr },
    ingest_one_time: { rows: ic.rows, usd: ic.usd, inr: ic.inr },
    ingest_amortised_over_carousels_so_far: { carousels: n, usd: ic.usd / n, inr: ic.inr / n },
    usd_inr: fx.usd_inr, fx_checked: fx.checked,
  };
}

/** Writes instagram.pdf, instagram_pngs.zip, linkedin.pdf, captions.txt, cost.json (+ everything.zip) into <dir>/export. */
export async function exportCarousel(dir: string, carousel: CarouselRow, igPngs: string[], liPngs: string[]) {
  const ex = path.join(dir, "export");
  await fs.mkdir(ex, { recursive: true });
  const f = (n: string) => path.join(ex, n);
  await buildPdf(igPngs, f("instagram.pdf"));
  await buildPdf(liPngs, f("linkedin.pdf"));
  await buildZip(igPngs.map((p, i) => ({ name: `${String(i + 1).padStart(2, "0")}.png`, path: p })), f("instagram_pngs.zip"));
  await fs.writeFile(f("captions.txt"), captionsTxt(carousel.copy!));
  await fs.writeFile(f("cost.json"), JSON.stringify(costReport(carousel), null, 2));
  await buildZip(["instagram.pdf", "instagram_pngs.zip", "linkedin.pdf", "captions.txt", "cost.json"].map((n) => ({ name: n, path: f(n) })), f("everything.zip"));
  return Object.fromEntries(["instagram.pdf", "instagram_pngs.zip", "linkedin.pdf", "captions.txt", "cost.json", "everything.zip"].map((n) => [n, f(n)]));
}
