import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Extraction } from "./extract";

const run = promisify(execFile);

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** One atomic guideline from the look book, with its source and how adherence is verified. */
export const Guideline = z.object({
  id: z.string(), section: z.string(), page: z.number().int(), quote: z.string(), statement: z.string(),
  category: z.enum(["structure", "content", "design", "voice", "captions", "brand"]),
  scope: z.enum(["slide", "carousel", "caption", "brand"]),
  method: z.enum(["code", "template", "review", "info"]).describe("code = checked by code on the output; template = guaranteed/verified in the template kit; review = AI-reviewed after generation; info = context only"),
  check: z.object({ type: z.string(), params: z.record(z.string(), z.unknown()).default({}) }).optional(),
  enabled: z.boolean().default(true),
});
export type Guideline = z.infer<typeof Guideline>;
export const Format = z.object({ id: z.string(), name: z.string(), description: z.string(), kind: z.enum(["single", "carousel"]), label: z.string().default(""), slides: z.number().int().optional(), stamped: z.boolean().default(false), page: z.number().int().optional() });
export type Format = z.infer<typeof Format>;
const Params = z.record(z.string(), z.unknown()).default({});

export const StyleSpec = z.object({
  brand: z.object({ name: z.string(), handle: z.string().optional(), linkedin_handle: z.string().optional(), tagline: z.string().optional() }),
  colors: z.array(z.object({ token: z.string(), hex: Hex, role: z.string(), usage_notes: z.string().default(""), name: z.string().optional(), roles: z.array(z.string()).default([]) })).min(1),
  fonts: z.array(z.object({
    role: z.string(), family: z.string(), weights: z.array(z.number()).default([400]),
    devanagari_pair: z.string().describe("Google Fonts family that pairs with this role for Devanagari"),
    substituted: z.boolean().default(false), roles: z.array(z.string()).default([]), google_fonts_family: z.string().optional().describe("closest Google Fonts family if `family` is not on Google Fonts"),
  })).min(1),
  elements: z.array(z.object({
    id: z.string(), kind: z.string(), description: z.string(), css_hint: z.string().default(""), placement: z.string().default(""),
    rotation_deg: z.number().optional(), max_per_slide: z.number().optional(), enabled: z.boolean().default(true),
  })).default([]),
  layout: z.object({
    canvas: z.object({ w: z.number(), h: z.number() }).default({ w: 1080, h: 1350 }),
    margins_px: z.union([z.number(), z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })]).default(60),
    grid_notes: z.string().default(""),
    fixed_furniture: z.array(z.object({ what: z.string(), position: z.string(), content_hint: z.string().optional() })).default([]),
  }),
  archetypes: z.array(z.object({
    id: z.string(), purpose: z.string(), description: z.string(), background_token: z.string(),
    slots: z.array(z.object({
      name: z.string(), kind: z.string(), max_words: z.number().int().positive(), max_chars: z.number().int().positive(), optional: z.boolean().default(false),
    })).min(1),
    source_page: z.number().int().optional(),
  })).min(1),
  sequencing: z.array(z.object({ rule: z.string(), machine: z.object({ type: z.string(), params: Params }).optional() })).default([]),
  rules: z.array(z.object({ text: z.string(), machine: z.object({ type: z.string(), params: Params }).optional(), enabled: z.boolean().default(true) })).default([]),
  voice: z.object({ summary: z.string(), statements: z.array(z.string()).default([]), do: z.array(z.string()).default([]), dont: z.array(z.string()).default([]), examples: z.array(z.string()).default([]) }),
  assets: z.array(z.object({
    id: z.string(), kind: z.string(), page: z.number().int(), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("fractions of the page, 0..1"),
  })).default([]),
  confidence: z.object({ overall: z.number().min(0).max(1), low_confidence_fields: z.array(z.string()).default([]) }),
  // everything the look book states, parsed from its document anatomy (see anatomy.ts / guidelines.ts)
  guidelines: z.array(Guideline).default([]),
  formats: z.array(Format).default([]),
  lookbook: z.object({
    concept: z.string().optional(), cadence: z.string().optional(), name: z.string().optional(), handle: z.string().optional(), tagline: z.array(z.string()).default([]),
    highlights: z.array(z.string()).default([]), feedRules: z.array(z.string()).default([]), slides: z.number().int().optional(), motto: z.string().optional(), coverPage: z.number().int().optional(), insidePage: z.number().int().optional(),
    logo: z.object({ description: z.string().optional(), usage: z.string().optional() }).optional(), coverage: z.object({ blocks: z.number(), mapped: z.number() }).optional(), warnings: z.array(z.string()).default([]),
  }).optional(),
});
export type StyleSpec = z.infer<typeof StyleSpec>;

/** Pages worth sending to the vision model: all if few, otherwise keyword-matched + a spread of the rest. */
export function selectPages(x: Extraction, maxPages = 8): number[] {
  const n = x.info.pages;
  if (n <= maxPages) return Array.from({ length: n }, (_, i) => i + 1);
  const kw = /colou?r|type|typograph|font|element|slide|carousel|voice|tone|rule|logo|palette|layout|grid|template|post/i;
  const scored = x.texts.map((t, i) => ({ p: i + 1, s: (t.match(new RegExp(kw, "gi")) ?? []).length }));
  const picked = new Set(scored.sort((a, b) => b.s - a.s).slice(0, maxPages).map((s) => s.p));
  return [...picked].sort((a, b) => a - b);
}

/** Render selected pages with the long edge capped (default 1024px), without any image library. */
export async function renderForVision(pdf: string, pages: number[], outDir: string, longEdge = 1024): Promise<Buffer[]> {
  await fs.mkdir(outDir, { recursive: true });
  const bufs: Buffer[] = [];
  for (const p of pages) {
    const base = path.join(outDir, `v${p}`);
    await run("pdftoppm", ["-f", String(p), "-l", String(p), "-scale-to", String(longEdge), "-png", "-singlefile", pdf, base]);
    bufs.push(await fs.readFile(base + ".png"));
  }
  return bufs;
}

const PROMPT = path.join(process.cwd(), "lib/prompts");
export async function loadPrompt(name: string): Promise<{ version: string; body: string }> {
  const raw = await fs.readFile(path.join(PROMPT, name), "utf8");
  const m = /^<!--\s*version:\s*([^\s]+)\s*-->\n/.exec(raw);
  return { version: m?.[1] ?? "0", body: raw.replace(/^<!--[^]*?-->\n/, "") };
}

/** User message for the spec call. Static instructions live in the system prompt. */
export function buildSpecUserMessage(x: Extraction, pages: number[], anatomy?: import("./anatomy").Anatomy | null): string {
  const clip = (t: string) => (t.length > 2500 ? t.slice(0, 2500) + "\n…[truncated]" : t);
  const parts = [
    `PDF: ${x.info.pages} pages, ${x.info.widthPt}x${x.info.heightPt}pt. Images attached are pages ${pages.join(", ")} in that order.`,
    x.imageOnly ? "NOTE: this PDF has NO usable text layer (scanned/image-only). Read everything from the images and lower your confidence accordingly." : "",
    `## Fonts embedded in the PDF (normalised; \`likelySystemFallback\` means stray-glyph fallback, not a brand font)\n${JSON.stringify(x.fonts.map((f) => ({ family: f.family, weights: f.weights, pages: f.pages, likelySystemFallback: f.likelySystemFallback })))}`,
    `## Hex codes found in text\n${JSON.stringify(x.hexFromText)}`,
    `## Dominant colours measured from rendered pages (k-means)\n${JSON.stringify(x.palette.map((s) => ({ hex: s.hex, share: +s.share.toFixed(3) })))}`,
    `## Raster images in PDF: ${x.images.length}${x.images.length ? " (logo may be raster)" : " (none: logo is vector/typographic if present)"}`,
    anatomy ? `## Look book anatomy, PARSED EXACTLY from the PDF structure (treat as ground truth; never contradict it)\n${JSON.stringify({
      page_kinds: anatomy.pages.map((p) => `${p.page}:${p.kind}`), concept: anatomy.concept,
      colours: anatomy.colours.map((c) => ({ name: c.name, hex: c.hex, used_for: c.roles })),
      type: anatomy.type.map((t) => ({ family: t.family, weights: t.weights, used_for: t.roles })),
      elements: anatomy.elements.map((e) => ({ name: e.name, detail: e.modifier, rotation_deg: e.rotation })),
      pillars: anatomy.pillars.map((p) => ({ name: p.name, what: p.description, kind: p.kind, style: p.label })), cadence: anatomy.cadence,
      post_pages: anatomy.posts.map((p) => ({ page: p.page, pillar: p.pillar })), carousel: anatomy.carousel && { cover_page: anatomy.carousel.coverPage, inside_page: anatomy.carousel.insidePage, slides: anatomy.carousel.slides, motto: anatomy.carousel.motto },
      rules: anatomy.rules.flatMap((r) => r.atoms), voice: anatomy.voice?.sentences, logo: anatomy.logo?.rule, feed: anatomy.profile?.feedRules, tagline: anatomy.profile?.tagline })}` : "",
    `## Text per page\n${x.texts.map((t, i) => (pages.includes(i + 1) || !t ? `--- page ${i + 1} ---\n${clip(t)}` : `--- page ${i + 1} ---\n${clip(t).slice(0, 600)}`)).join("\n")}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}

/** Compressed spec for generation-time prompts (target ≤1.5k tokens). Drops prose the generator doesn't need. */
export function specDigest(s: StyleSpec): string {
  const d = {
    brand: s.brand,
    archetypes: s.archetypes.map((a) => ({ id: a.id, purpose: a.purpose, bg: a.background_token, slots: a.slots.map((l) => `${l.name}:${l.kind}≤${l.max_words}w/${l.max_chars}c${l.optional ? "?" : ""}`) })),
    colors: s.colors.map((c) => `${c.token}=${c.role}`),
    sequencing: s.sequencing.map((r) => r.rule),
    rules: s.rules.filter((r) => r.enabled).map((r) => r.text),
    furniture: s.layout.fixed_furniture.map((f) => `${f.what}@${f.position}`),
    voice: { summary: s.voice.summary, do: s.voice.do, dont: s.voice.dont, examples: s.voice.examples.slice(0, 3) },
  };
  return JSON.stringify(d);
}
