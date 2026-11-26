import path from "node:path";
import { pdfInfo, pageTexts, rawFonts, renderPages, renderPagePpm, listImages, type PdfInfo, type PdfImage } from "./pdf";
import { normaliseFonts, type NormFont } from "./fonts";
import { hexFromText, kmeansPalette, parsePpm, type HexHit, type Swatch } from "./colors";

export type Extraction = {
  info: PdfInfo;
  texts: string[];
  fonts: NormFont[];
  hexFromText: HexHit[];
  palette: Swatch[];
  images: PdfImage[];
  pagePngs: string[];
  imageOnly: boolean; // scanned / no text layer: spec must come from vision only
  canvas: { w: number; h: number; scale: number };
};

const MIN_TEXT_CHARS_PER_PAGE = 20;
const TARGET_W = 1080;

export async function extractDeterministic(pdf: string, pagesDir: string): Promise<Extraction> {
  const info = await pdfInfo(pdf);
  const [texts, raw, images, pagePngs] = await Promise.all([
    pageTexts(pdf, info.pages),
    rawFonts(pdf, info.pages),
    listImages(pdf),
    renderPages(pdf, pagesDir, 72),
  ]);
  const totalChars = texts.join("").replace(/\s/g, "").length;
  const imageOnly = totalChars < MIN_TEXT_CHARS_PER_PAGE * info.pages * 0.5;
  // palette: pool low-res renders of every page (capped) so one dominant page doesn't hide accent colours
  const ppms: ReturnType<typeof parsePpm>[] = [];
  const step = Math.max(1, Math.ceil(info.pages / 12));
  for (let p = 1; p <= info.pages; p += step) ppms.push(parsePpm(await renderPagePpm(pdf, p, 24)));
  // canvas: the app's exports are 1080 wide; keep the look book's aspect ratio. The spec may override.
  const scale = TARGET_W / info.widthPt;
  return {
    info, texts, fonts: normaliseFonts(raw), hexFromText: hexFromText(texts), palette: kmeansPalette(ppms, 12),
    images, pagePngs, imageOnly, canvas: { w: TARGET_W, h: Math.round(info.heightPt * scale), scale },
  };
}
export { path };
