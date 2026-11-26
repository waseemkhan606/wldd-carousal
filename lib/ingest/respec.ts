// Applying a user's edits to the Style Spec WITHOUT an LLM: colour/font variables, font files and per-archetype budgets
// are re-compiled deterministically from the stored kit. Only a structural change (archetypes/slots/elements) needs a rebuild.
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { getBrand, getLookbook, lookbookDir } from "../db/repo";
import { StyleSpec } from "./spec";
import { writeKit, type KitOutput } from "./kit";
import { fetchGoogleFont, fetchDevanagariPair } from "./fonts";
import { renderSlide } from "../render/renderer";

const sig = (s: StyleSpec) => JSON.stringify({ a: s.archetypes.map((x) => [x.id, x.background_token, x.slots.map((y) => [y.name, y.kind])]), e: s.elements.map((x) => [x.id, x.enabled !== false]), f: s.layout.fixed_furniture.map((x) => x.what) });
const fontSig = (s: StyleSpec) => JSON.stringify(s.fonts.map((f) => [f.role, f.google_fonts_family ?? f.family, f.devanagari_pair, [...f.weights].sort()]));

export async function applySpecEdit(lookbookId: number, input: unknown): Promise<{ warnings: string[]; needsRebuild: boolean; changes: string[] }> {
  const lb = getLookbook(lookbookId); if (!lb || !lb.spec_json) throw new Error("This look book has no spec yet.");
  const next = StyleSpec.parse(input), prev = StyleSpec.parse(JSON.parse(lb.spec_json));
  const brand = getBrand(lb.brand_id)!, dir = lookbookDir(brand.slug, lb.version);
  const warnings: string[] = [], changes: string[] = [];
  const tokens = new Set(next.colors.map((c) => c.token));
  for (const a of next.archetypes) if (!tokens.has(a.background_token)) throw new Error(`Archetype "${a.id}" uses a colour token that doesn't exist: ${a.background_token}`);

  const needsRebuild = sig(prev) !== sig(next);
  if (needsRebuild) changes.push("archetype/element structure changed: rebuild the kit to apply it");
  if (JSON.stringify(prev.colors) !== JSON.stringify(next.colors)) changes.push("colours");
  if (fontSig(prev) !== fontSig(next)) {
    changes.push("fonts");
    const css: string[] = [], fontDir = path.join(dir, "fonts");
    for (const f of next.fonts) {
      const latin = await fetchGoogleFont(f.google_fonts_family ?? f.family, f.weights, fontDir);
      if (latin.found) css.push(latin.css); else { f.substituted = true; warnings.push(`Font "${f.google_fonts_family ?? f.family}" (${f.role}) was not found on Google Fonts (${latin.error}).`); }
      const dev = await fetchDevanagariPair(f.devanagari_pair, f.weights, fontDir);
      if (dev.css) css.push(dev.css);
      if (dev.replaced) f.devanagari_pair = dev.family;
      if (dev.note) warnings.push(`${f.role}: ${dev.note}`);
    }
    await fs.writeFile(path.join(fontDir, "fonts.css"), css.join("\n"));
  }
  if (JSON.stringify(prev.voice) !== JSON.stringify(next.voice) || JSON.stringify(prev.rules) !== JSON.stringify(next.rules) || JSON.stringify(prev.sequencing) !== JSON.stringify(next.sequencing)) changes.push("voice/rules (used by the next carousel)");

  await fs.writeFile(path.join(dir, "spec.json"), JSON.stringify(next, null, 2));
  db().prepare("UPDATE lookbooks SET spec_json=?, spec_user_edited=1 WHERE id=?").run(JSON.stringify(next), lookbookId);

  // deterministic re-compile of the existing kit with the edited variables/fonts/budgets
  if (lb.kit_path) {
    try {
      const kit: KitOutput = JSON.parse(await fs.readFile(path.join(lb.kit_path, "kit.source.json"), "utf8"));
      const fontsCss = await fs.readFile(path.join(dir, "fonts", "fonts.css"), "utf8");
      const manifest = await writeKit(lb.kit_path, next, kit, fontsCss, "edited");
      await fs.mkdir(path.join(lb.kit_path, "previews"), { recursive: true });
      for (const a of manifest.archetypes) {
        const r = await renderSlide({ kitDir: lb.kit_path, manifest, archetypeId: a.id, slots: a.sample_slots, vars: { idx: 1, total: 5, handle: next.brand.handle ?? "", brand: next.brand.name } });
        await fs.writeFile(path.join(lb.kit_path, "previews", `${a.id}.png`), r.png);
        if (r.problems.some((p) => /^FONT_LOAD/.test(p))) warnings.push(`Font failed to load for ${a.id}: ${r.problems.find((p) => /^FONT_LOAD/.test(p))}`);
      }
    } catch (e: any) { warnings.push(`Kit re-compile failed: ${String(e.message).slice(0, 160)}`); }
  }
  return { warnings, needsRebuild, changes };
}
