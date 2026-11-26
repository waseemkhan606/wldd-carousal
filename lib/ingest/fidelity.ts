import { z } from "zod";
import sharp from "sharp";
import { loadPrompt } from "./spec";
import { llmCall } from "../llm/router";

const Cat = z.number().min(0).max(100);
export const FidelityRaw = z.object({
  checks: z.object({ background: Cat, colour_usage: Cat, typography: Cat, alignment_spacing: Cat, decor_elements: Cat, furniture: Cat }),
  diffs: z.array(z.object({ area: z.string(), issue: z.string(), fix: z.string() })).default([]),
});
export type Fidelity = { score: number; checks: z.infer<typeof FidelityRaw>["checks"]; diffs: z.infer<typeof FidelityRaw>["diffs"] };

/** Score is computed here, not chosen by the model: the worst categories dominate so one big miss can't hide behind averages. */
export function combine(checks: Fidelity["checks"]): number {
  const v = Object.values(checks);
  return Math.round(0.6 * (v.reduce((a, b) => a + b, 0) / v.length) + 0.4 * Math.min(...v));
}

/** Downscale a render to ≤1024 long edge before it goes to a vision model (cost lever #8). */
export const downscale = (png: Buffer, longEdge = 1024) => sharp(png).resize({ width: longEdge, height: longEdge, fit: "inside", withoutEnlargement: true }).png().toBuffer();

/** Render (left) + reference (right) in one image: cheaper than two images and far easier for a model to compare. */
export async function sideBySide(rendered: Buffer, reference: Buffer, h = 900): Promise<Buffer> {
  const a = await sharp(rendered).resize({ height: h }).png().toBuffer();
  const b = await sharp(reference).resize({ height: h, fit: "contain", background: "#ffffff" }).png().toBuffer();
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  const gap = 24;
  return sharp({ create: { width: ma.width! + gap + mb.width!, height: h, channels: 3, background: "#808080" } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: ma.width! + gap, top: 0 }]).png().toBuffer();
}

export async function scoreFidelity(opts: { rendered: Buffer; reference: Buffer; archetypeId: string; lookbookId: number }): Promise<Fidelity> {
  const prompt = await loadPrompt("fidelity.md");
  const { data } = await llmCall({
    stage: "ingest.fidelity", tier: "vision_cheap", system: prompt.body,
    user: `Template: "${opts.archetypeId}". Left = render, right = look book reference.`,
    images: [await sideBySide(opts.rendered, opts.reference)], schema: FidelityRaw, lookbookId: opts.lookbookId, maxOutTokens: 3000,
  });
  return { score: combine(data.checks), checks: data.checks, diffs: data.diffs };
}
