// Playwright pool: one browser, one reusable page per kit. Text goes in via textContent, never as HTML.
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs/promises";
import sharp from "sharp";
import path from "node:path";
import { PAGE_SCRIPT } from "./page-script";
import type { KitManifest } from "../ingest/kit";

const g = globalThis as unknown as { __browser?: Promise<Browser>; __pages?: Map<string, { page: Page; stamp: number }>; __queue?: Promise<unknown> };

async function browser(): Promise<Browser> {
  if (!g.__browser) {
    g.__browser = chromium.launch().catch((e) => {
      g.__browser = undefined;
      throw new Error(`Could not start Chromium (${e.message}). Run: npx playwright install chromium`);
    });
  }
  return g.__browser;
}
export async function closeBrowser() {
  if (g.__browser) { await (await g.__browser).close(); g.__browser = undefined; g.__pages = undefined; }
}

async function kitPage(kitDir: string): Promise<Page> {
  const stamp = (await fs.stat(path.join(kitDir, "kit.css"))).mtimeMs;
  const pages = (g.__pages ??= new Map());
  const hit = pages.get(kitDir);
  if (hit && hit.stamp === stamp) return hit.page;
  await hit?.page.close();
  const ctx = await (await browser()).newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  // Kits must be self-contained: anything that tries to leave the machine is a kit bug, so fail it loudly.
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto("file://" + path.join(kitDir, "shell.html"));
  await page.evaluate(PAGE_SCRIPT);
  pages.set(kitDir, { page, stamp });
  return page;
}

/** Counters for the e2e report: every render runs the text-integrity assertion. */
export const renderStats = { renders: 0, integrityChecks: 0, integrityFailures: 0 };

export type SlotDiag = { size: number; overflow: boolean; textOk: boolean; rect?: { x: number; y: number; w: number; h: number }; elW?: number; ls?: number; ff?: string; lh?: number; color?: string; bg?: string; bd?: string };
export type RenderDiag = {
  rootBg?: string; rootSize: { w: number; h: number }; contentOverflow: boolean; missingFonts: string[]; slots: Record<string, SlotDiag>;
  missingSlots: string[]; extraSlots: string[]; furniture: string[]; furnitureMisplaced: string[]; collisions: string[]; furnStats?: Record<string, SlotDiag>; words?: { t: string; n: string; x: number; y: number; w: number; h: number }[];
};
export type RenderResult = { png: Buffer; diag: RenderDiag; problems: string[] };

export type RenderInput = {
  kitDir: string; manifest: KitManifest; archetypeId: string; slots: Record<string, string>;
  vars: { idx: number | string; total: number | string; handle?: string; brand?: string };
  caps?: Record<string, number>; // per-slot font-size ceilings (consistent type size across a carousel)
  polish?: boolean; // generation-time typography (balanced headlines, no orphans); off at ingest so kits are measured against the reference as-is
};

/** Serialise renders on the shared page (one page per kit; DOM is mutated per render). */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = (g.__queue ?? Promise.resolve()).then(fn, fn);
  g.__queue = next.catch(() => {});
  return next;
}

export function renderSlide(inp: RenderInput): Promise<RenderResult> {
  return enqueue(async () => {
    if (!inp.manifest.margins) throw new Error("This kit was built by an older compiler (no safe-area margins in its manifest). Rebuild the kit.");
    const a = inp.manifest.archetypes.find((x) => x.id === inp.archetypeId);
    if (!a) throw new Error(`Unknown archetype "${inp.archetypeId}"`);
    const html = await fs.readFile(path.join(inp.kitDir, a.file), "utf8");
    const page = await kitPage(inp.kitDir);
    const diag: RenderDiag = await page.evaluate(
      `window.__cs.render(${JSON.stringify({ html, slots: inp.slots, vars: inp.vars, families: inp.manifest.families, slotNames: a.slots.map((s) => s.name), furniturePositions: inp.manifest.furniture, margins: inp.manifest.margins, polish: !!inp.polish, caps: inp.caps ?? {}, kinds: Object.fromEntries(a.slots.map((s) => [s.name, s.kind])) })})`,
    );
    const problems = diagnosticsToProblems(diag, a.slots.filter((s) => !s.optional).map((s) => s.name));
    renderStats.renders++; renderStats.integrityChecks += Object.keys(diag.slots).length; renderStats.integrityFailures += problems.filter((p) => p.startsWith("TEXT_INTEGRITY")).length;
    const png = await page.locator("#root").screenshot({ type: "png" });
    const { w, h } = pngSize(png);
    if (w !== 1080 || h !== 1350) problems.push(`PNG is ${w}x${h}, expected 1080x1350`);
    problems.push(...(await inkProblems(page, png, diag, inp.slots)));
    return { png, diag, problems };
  });
}

export function pngSize(b: Buffer) {
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Hard failures (fonts, text integrity, geometry) vs. content problems (overflow) are both "problems"; callers decide. */
export function diagnosticsToProblems(d: RenderDiag, required: string[]): string[] {
  const p: string[] = [];
  if (d.missingFonts.length) p.push(`FONT_LOAD: ${d.missingFonts.join(", ")}`);
  if (d.rootSize.w !== 1080 || d.rootSize.h !== 1350) p.push(`Root is ${d.rootSize.w}x${d.rootSize.h}, must be exactly 1080x1350`);
  if (d.contentOverflow) p.push("Content spills outside the 1080x1350 root");
  for (const n of d.missingSlots) if (required.includes(n)) p.push(`Slot "${n}" is missing from the template`);
  for (const [n, s] of Object.entries(d.slots)) {
    if (!s.textOk) p.push(`TEXT_INTEGRITY: slot "${n}" DOM text differs from the validated text`);
    if (s.overflow) p.push(`OVERFLOW: slot "${n}" does not fit inside its box and the safe margins even at its minimum size`);
  }
  p.push(...d.furnitureMisplaced.map((m) => `Furniture: ${m}`));
  p.push(...(d.collisions ?? []).map((c) => `COLLISION: text of ${c}`));
  return p;
}

/**
 * The DOM can say a slot has text while the pixels show nothing (a mask/clip-path on a container, a covering layer,
 * text coloured like its background). Differential test: render again with slot text hidden; if a slot's rectangle is
 * pixel-identical either way, its text was never visible. Absolute contrast can't work (textured backgrounds).
 */
export async function inkProblems(page: Page, png: Buffer, diag: RenderDiag, slots: Record<string, string>): Promise<string[]> {
  const targets = Object.entries(diag.slots).filter(([n, s]) => s.rect && (slots[n] ?? "").replace(/\*/g, "").trim() && s.rect.w >= 2 && s.rect.h >= 2);
  if (!targets.length) return [];
  await page.evaluate(`document.querySelectorAll("[data-slot]").forEach((e) => { e.style.visibility = "hidden"; })`);
  const blank = await page.locator("#root").screenshot({ type: "png" });
  const [a, b] = await Promise.all([sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(blank).removeAlpha().raw().toBuffer()]);
  const W = a.info.width, ch = a.info.channels;
  const out: string[] = [];
  for (const [name, s] of targets) {
    const r = s.rect!;
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(a.info.height, Math.ceil(r.y + r.h));
    let changed = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * ch;
      if (Math.abs(a.data[o] - b[o]) + Math.abs(a.data[o + 1] - b[o + 1]) + Math.abs(a.data[o + 2] - b[o + 2]) > 30) changed++;
    }
    if (changed < 12) out.push(`INVISIBLE: slot "${name}" has text in the DOM but shows no visible ink in the render. Likely cause: a mask-image/clip-path/opacity on it or a container, a layer covering it, or text coloured like its background. Never put mask or clip-path on an element that contains slots; apply it to a separate decorative sibling.`);
  }
  return out;
}
