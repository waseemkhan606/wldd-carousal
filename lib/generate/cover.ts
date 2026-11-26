// Cover director: spend part of the per-carousel budget on the one slide that decides whether anyone swipes.
// Several alternative covers are written, ALL are rendered (free), invalid ones are dropped by the deterministic checks,
// and a vision judge picks the best by hook, visual and brand fit.
import { z } from "zod";
import sharp from "sharp";
import { llmCall } from "../llm/router";
import { loadPrompt } from "../ingest/spec";
import { buildSystem, requirementsText, slideSchemaText, SlideSchema } from "./plan";
import { validateSlide, slotsFor, plain } from "./validate";
import { LANGUAGES, PLATFORM_IDS } from "./platforms";
import { renderSlide } from "../render/renderer";
import type { Ctx } from "./ctx";
import type { CopyData, Lang, SlideCopy } from "../db/carousels";

const Slots = z.record(z.string(), z.string());
const Options = z.object({ options: z.array(z.object({ angle: z.string(), slots: Slots, overrides: z.object({ instagram: Slots.optional(), linkedin: Slots.optional() }).optional() })).min(1) });
const Judge = z.object({ scores: z.array(z.object({ id: z.number().int(), hook: z.number(), visual: z.number(), brand: z.number() })).min(1), best: z.number().int(), reason: z.string() });

export const COVER_OPTIONS = Number(process.env.COVER_OPTIONS ?? 4);

async function sheet(pngs: Buffer[]): Promise<Buffer> {
  const W = 480, H = 600, gap = 16, cols = Math.min(3, pngs.length), rows = Math.ceil(pngs.length / cols);
  const tiles = await Promise.all(pngs.map(async (p, i) => {
    const t = await sharp(p).resize(W, H).png().toBuffer();
    const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><circle cx="38" cy="38" r="26" fill="#111" stroke="#fff" stroke-width="3"/><text x="38" y="49" font-size="32" font-weight="700" font-family="Arial,Helvetica,sans-serif" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`);
    return { input: await sharp(t).composite([{ input: badge }]).png().toBuffer(), left: (i % cols) * (W + gap), top: Math.floor(i / cols) * (H + gap) };
  }));
  return sharp({ create: { width: cols * W + (cols - 1) * gap, height: rows * H + (rows - 1) * gap, channels: 3, background: "#808080" } }).composite(tiles).png().toBuffer();
}

export type CoverResult = { chosen: SlideCopy; considered: number; picked: number; reason: string; angle?: string };

export async function improveCover(ctx: Ctx, carouselId: number, copy: CopyData, lang: Lang, topic: string, progress: (s: string, d?: string) => void): Promise<CoverResult | null> {
  const cover = copy.slides[0], n = copy.slides.length;
  if (!cover || !ctx.manifest.archetypes.some((a) => a.id === cover.archetype)) return null;
  progress("cover", "Cover director: writing alternative covers");
  const { system } = await buildSystem(ctx.spec, ctx.manifest, "cover.md");
  const heads = copy.slides.slice(1).map((s) => `${s.idx}. ${Object.values(s.slots).find((v) => v) ?? ""}`).join("\n");
  const user = [`Topic: ${topic}\nLanguage: ${LANGUAGES[lang]}\nWrite exactly ${COVER_OPTIONS} options.`, `Cover archetype "${cover.archetype}". Slots: ${slideSchemaText(ctx.manifest, cover.archetype)}`,
    `Requirements:\n${requirementsText(ctx.spec, n, ctx.manifest)}`, `Current cover: ${JSON.stringify({ slots: cover.slots, overrides: cover.overrides })}`, `What the rest of the carousel delivers (slide: main line):\n${heads}`].join("\n\n");
  let opts: z.infer<typeof Options>["options"] = [];
  try { opts = (await llmCall({ stage: "carousel.cover", tier: "text_strong", system, user, schema: Options, carouselId, maxOutTokens: 4000, thinking: 1500 })).data.options; }
  catch (e: any) { progress("cover", `Cover director unavailable (${String(e.message).slice(0, 90)}); keeping the first cover`); return null; }

  const candidates: { slide: SlideCopy; angle: string }[] = [{ slide: cover, angle: "original" }, ...opts.map((o) => ({ slide: { idx: 1, archetype: cover.archetype, slots: o.slots, overrides: o.overrides } as SlideCopy, angle: o.angle }))];
  const ok: { slide: SlideCopy; angle: string; png: Buffer }[] = [], dropped: string[] = [];
  progress("cover", "Rendering candidate covers");
  for (const c of candidates) {
    const iss = validateSlide(c.slide, ctx.spec, ctx.manifest, lang, n, copy.slides);
    if (iss.length) { dropped.push(`${c.angle}: ${iss[0].msg}`); continue; } // hard limits, rules, script
    const r = await renderSlide({ kitDir: ctx.kitDir, manifest: ctx.manifest, archetypeId: c.slide.archetype, slots: slotsFor(c.slide, "instagram"), polish: true, vars: { idx: 1, total: n, handle: ctx.spec.brand.handle ?? "", brand: ctx.spec.brand.name } });
    const bad = r.problems.find((p) => /^(TEXT_INTEGRITY|FONT_LOAD|OVERFLOW|INVISIBLE)/.test(p));
    if (bad) { dropped.push(`${c.angle}: ${bad.slice(0, 90)}`); continue; }
    ok.push({ ...c, png: r.png });
  }
  if (ok.length < 2) { progress("cover", `No alternative cover passed the checks (${dropped.slice(0, 3).join(" | ")})`); return { chosen: cover, considered: ok.length, picked: 0, reason: `no valid alternatives: ${dropped.slice(0, 3).join(" | ")}` }; }

  progress("cover", `Judging ${ok.length} covers`);
  const judgeSys = (await loadPrompt("cover_judge.md")).body + `\n\nBrand voice: ${ctx.spec.voice.summary}\nDo: ${ctx.spec.voice.do.join("; ")}\nDon't: ${ctx.spec.voice.dont.join("; ")}`;
  const listing = ok.map((c, i) => `${i + 1}. [${c.angle}] ${Object.entries(slotsFor(c.slide, "instagram")).map(([k, v]) => `${k}: ${plain(v)}`).join(" | ")}`).join("\n");
  try {
    const { data } = await llmCall({ stage: "carousel.cover_judge", tier: "vision_cheap", system: judgeSys, user: `Topic: ${topic}\nLanguage: ${LANGUAGES[lang]}\nCandidates:\n${listing}`, images: [await sheet(ok.map((c) => c.png))], schema: Judge, carouselId, maxOutTokens: 1500 });
    const total = (s: { hook: number; visual: number; brand: number }) => 0.4 * s.hook + 0.35 * s.visual + 0.25 * s.brand;
    const ranked = data.scores.filter((s) => s.id >= 1 && s.id <= ok.length).sort((a, b) => total(b) - total(a) || (b.id === data.best ? 1 : 0) - (a.id === data.best ? 1 : 0));
    const pick = ranked[0]?.id ?? 1, win = ok[pick - 1];
    return { chosen: win.slide, considered: ok.length, picked: pick, reason: data.reason, angle: win.angle };
  } catch (e: any) {
    progress("cover", `Cover judge unavailable (${String(e.message).slice(0, 90)}); keeping the first cover`);
    return { chosen: cover, considered: ok.length, picked: 1, reason: "judge unavailable" };
  }
}
export { PLATFORM_IDS };
