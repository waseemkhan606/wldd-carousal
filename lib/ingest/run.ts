import fs from "node:fs/promises";
import path from "node:path";
import { assertCredits } from "../llm/preflight";
import { db } from "../db";
import { getLookbook, getBrand, lookbookDir } from "../db/repo";
import { extractDeterministic } from "./extract";
import { StyleSpec, selectPages, renderForVision, buildSpecUserMessage, loadPrompt } from "./spec";
import { fetchGoogleFont, fetchDevanagariPair } from "./fonts";
import { lintSpec } from "./lint";
import { analyseLookbook } from "./anatomy";
import { reconcileSpec } from "./guidelines";
import { cropPage } from "./pdf";
import { llmCall } from "../llm/router";
import { lookbookCost } from "../llm/usage";
import { compileKit, type KitReport } from "./compile";

export type Progress = (stage: string, detail?: string) => void;
export type IngestResult = { spec: StyleSpec; warnings: string[]; costUsd: number; kit?: KitReport };

/** Look book PDF -> spec.json + fonts + assets. Runs once per look book version. */
export async function ingestLookbook(lookbookId: number, progress: Progress = () => {}, opts: { force?: boolean } = {}): Promise<IngestResult> {
  const lb = getLookbook(lookbookId);
  if (!lb) throw new Error("Look book not found");
  const brand = getBrand(lb.brand_id)!;
  const dir = lookbookDir(brand.slug, lb.version);
  const warnings: string[] = [];
  db().prepare("UPDATE lookbooks SET status='ingesting' WHERE id=?").run(lookbookId);
  try {
    // Resume: a stored spec means the expensive vision call already succeeded, so don't pay for it twice.
    if (lb.spec_json && !opts.force) {
      progress("spec", "Reusing stored style spec (no vision call)");
      const spec = StyleSpec.parse(JSON.parse(lb.spec_json));
      const kit = await compileKit(lookbookId, progress, { reuse: true }); // the stored kit was already paid for: re-run only the free steps
      return { spec, warnings: kit.warnings, costUsd: kit.costUsd, kit };
    }
    await assertCredits(Number(process.env.INGEST_PREFLIGHT_USD ?? 1.0), "reading this look book");
    progress("extract", "Reading PDF text, fonts and colours");
    const x = await extractDeterministic(lb.source_path, path.join(dir, "pages"));
    if (x.imageOnly) warnings.push("This PDF has no text layer (scanned/image-only). The spec comes from vision alone, so expect lower confidence. Review it carefully.");

    progress("extract", "Parsing the look book structure: sections, rules, voice");
    const anatomy = await analyseLookbook(lb.source_path).catch(() => null);
    if (anatomy?.warnings.length) warnings.push(...anatomy.warnings.map((w) => `Look book structure: ${w}`));
    progress("vision", "Asking the vision model for the style spec (one-time cost)");
    const pages = selectPages(x);
    const images = await renderForVision(lb.source_path, pages, path.join(dir, "vision"));
    const prompt = await loadPrompt("spec.md");
    const { data: specRaw } = await llmCall({
      stage: "ingest.spec", tier: "vision_strong", system: prompt.body, user: buildSpecUserMessage(x, pages, anatomy),
      images, schema: StyleSpec, lookbookId, timeoutMs: 300000, maxOutTokens: 16000,
    });

    // nothing the look book states may be lost: merge the parsed structure into the spec (names, roles, rules, voice, formats)
    const spec = anatomy ? reconcileSpec(specRaw, anatomy) : specRaw;
    if (anatomy) await fs.writeFile(path.join(dir, "anatomy.json"), JSON.stringify(anatomy, null, 1));
    progress("fonts", "Downloading fonts from Google Fonts");
    spec.layout.canvas = { w: 1080, h: 1350 };
    const css: string[] = [];
    const fontDir = path.join(dir, "fonts");
    for (const f of spec.fonts) {
      const latin = await fetchGoogleFont(f.google_fonts_family ?? f.family, f.weights, fontDir);
      if (latin.found) { css.push(latin.css); if (latin.weights.join() !== [...new Set(f.weights)].sort((a, b) => a - b).join()) f.weights = latin.weights; }
      else { f.substituted = true; warnings.push(`Font "${f.family}" (${f.role}) not found on Google Fonts (${latin.error}). Rendering will fail until a font is chosen in the style review.`); }
      const dev = await fetchDevanagariPair(f.devanagari_pair, f.weights, fontDir);
      if (dev.css) css.push(dev.css);
      if (dev.replaced) f.devanagari_pair = dev.family;
      if (dev.note) warnings.push(`${f.role}: ${dev.note}`);
    }
    await fs.writeFile(path.join(fontDir, "fonts.css"), css.join("\n"));

    if (spec.assets.length) {
      progress("assets", "Cropping raster assets");
      await fs.mkdir(path.join(dir, "assets"), { recursive: true });
      for (const a of spec.assets) {
        try { await cropPage(lb.source_path, a.page, a.box, x.info, 300, path.join(dir, "assets", `${a.id}.png`)); }
        catch (e: any) { warnings.push(`Could not crop asset ${a.id}: ${e.message}`); }
      }
    }
    warnings.push(...lintSpec(spec));
    if (spec.confidence.overall < 0.6) warnings.push(`Low overall confidence (${spec.confidence.overall}). Review the extracted style.`);

    await fs.writeFile(path.join(dir, "spec.json"), JSON.stringify(spec, null, 2));
    await fs.writeFile(path.join(dir, "warnings.json"), JSON.stringify(warnings));
    const cost = lookbookCost(lookbookId);
    db().prepare("UPDATE lookbooks SET spec_json=?, ingest_cost_json=?, status='spec_ready' WHERE id=?").run(JSON.stringify(spec), JSON.stringify(cost), lookbookId);
    progress("spec", "Style spec ready");
    const kit = await compileKit(lookbookId, progress);
    warnings.push(...kit.warnings);
    return { spec, warnings, costUsd: kit.costUsd, kit };
  } catch (e) {
    db().prepare("UPDATE lookbooks SET status='failed' WHERE id=?").run(lookbookId);
    throw e;
  }
}
