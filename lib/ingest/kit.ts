import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { StyleSpec } from "./spec";
import { loadPrompt, renderForVision } from "./spec";
import { llmCall } from "../llm/router";

export const KitOutput = z.object({
  css: z.string().min(20),
  archetypes: z.array(z.object({
    id: z.string(), html: z.string().min(20),
    sample_slots: z.record(z.string(), z.string()).describe("realistic copy for every slot, quoted from the look book's sample for this archetype where possible"),
  })).min(1),
});
export type KitOutput = z.infer<typeof KitOutput>;

export type KitManifest = {
  promptVersion: string;
  archetypes: { id: string; file: string; background_token: string; slots: { name: string; kind: string; optional: boolean; max_words: number; max_chars: number }[]; sample_slots: Record<string, string> }[];
  families: { latin: string[]; devanagari: string[] };
  furniture: Record<string, string>; // what -> position, checked after render
  margins: { top: number; right: number; bottom: number; left: number };
  vars: { colors: Record<string, string>; fonts: Record<string, string> };
};

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const colorVar = (token: string) => `--c-${safe(token)}`;
export const fontVar = (role: string) => `--font-${safe(role)}`;

/** Deterministic part of the kit: colour/font variables. The LLM never writes hex values; it only references these. */
export function rootCss(spec: StyleSpec): { css: string; colors: Record<string, string>; fonts: Record<string, string> } {
  const colors: Record<string, string> = {}, fonts: Record<string, string> = {};
  const lines: string[] = [];
  for (const c of spec.colors) { colors[colorVar(c.token)] = c.hex; lines.push(`  ${colorVar(c.token)}: ${c.hex};`); }
  for (const f of spec.fonts) {
    const stack = `"${f.google_fonts_family ?? f.family}", "${f.devanagari_pair}"`;
    fonts[fontVar(f.role)] = stack; lines.push(`  ${fontVar(f.role)}: ${stack};`);
  }
  const m = spec.layout.margins_px;
  const mm = typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m;
  lines.push(`  --m-top: ${mm.top}px;`, `  --m-right: ${mm.right}px;`, `  --m-bottom: ${mm.bottom}px;`, `  --m-left: ${mm.left}px;`);
  return { css: `:root {\n${lines.join("\n")}\n}`, colors, fonts };
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;
/** Static constraints from the brief. Returns violations; empty = ok. */
export function validateKitStatic(kit: KitOutput, spec: StyleSpec): string[] {
  const v: string[] = [];
  const cssOutsideRoot = kit.css.replace(/:root\s*{[^}]*}/g, "");
  if (HEX.test(cssOutsideRoot)) v.push("CSS contains a hard-coded hex colour outside :root. Use var(--c-*) variables (or color-mix on them).");
  if (/@import|url\(\s*['"]?(https?:)?\/\//i.test(kit.css)) v.push("CSS references an external URL or @import. Kits must be self-contained.");
  if (/url\(/i.test(kit.css.replace(/url\(\s*['"]?(\.\.\/assets\/|data:image\/svg)[^)]*\)/gi, ""))) v.push("CSS url() may only point at ../assets/ files or inline SVG data URIs.");
  const ids = new Set(kit.archetypes.map((a) => a.id));
  for (const a of spec.archetypes) if (!ids.has(a.id)) v.push(`Archetype "${a.id}" is missing from the kit.`);
  for (const k of kit.archetypes) {
    const sa = spec.archetypes.find((a) => a.id === k.id);
    if (!sa) { v.push(`Kit has unknown archetype "${k.id}".`); continue; }
    const h = k.html;
    if (/<script|<iframe|<link|<style|<object|<embed/i.test(h)) v.push(`[${k.id}] HTML must not contain script/iframe/link/style tags.`);
    if (/\son\w+\s*=|javascript:/i.test(h)) v.push(`[${k.id}] HTML must not contain event handlers or javascript: URLs.`);
    if (/(src|href)\s*=\s*["']\s*(https?:)?\/\//i.test(h) || /url\(\s*['"]?(https?:)?\/\//i.test(h)) v.push(`[${k.id}] HTML references an external URL.`);
    if (HEX.test(h.replace(/&#\d+;/g, ""))) v.push(`[${k.id}] HTML contains a hard-coded hex colour (in a style attribute or SVG). Use var(--c-*).`);
    for (const s of sa.slots) if (!new RegExp(`data-slot=["']${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(h)) v.push(`[${k.id}] missing slot data-slot="${s.name}".`);
    for (const f of spec.layout.fixed_furniture) if (!h.includes(`data-furniture="${f.what}"`)) v.push(`[${k.id}] missing furniture data-furniture="${f.what}".`);
  }
  return v;
}

export function kitUserMessage(spec: StyleSpec, pages: number[], extra = "", geometry = ""): string {
  const { colors, fonts } = rootCss(spec);
  return [
    `Images attached are look book pages ${pages.join(", ")} in that order (they are the sample posts / reference pages).`,
    `## CSS variables already defined in :root (reference these, never redefine or hard-code values)\ncolours: ${Object.keys(colors).join(", ")}\nfonts: ${Object.keys(fonts).join(", ")}\nmargins: --m-top --m-right --m-bottom --m-left`,
    `## Furniture that must appear on EVERY archetype, with exact data-furniture strings\n${JSON.stringify(spec.layout.fixed_furniture)}`,
    `## Style Spec\n${JSON.stringify({ ...spec, elements: spec.elements.filter((e) => e.enabled !== false), assets: spec.assets })}`,
    geometry,
    extra,
  ].filter(Boolean).join("\n\n");
}

export async function generateKit(opts: { spec: StyleSpec; pdf: string; visionDir: string; lookbookId: number; geometry?: string }): Promise<{ kit: KitOutput; promptVersion: string; pages: number[] }> {
  const prompt = await loadPrompt("kit.md");
  const pages = [...new Set(opts.spec.archetypes.map((a) => a.source_page).filter((p): p is number => !!p))].sort((a, b) => a - b);
  const images = await renderForVision(opts.pdf, pages, opts.visionDir);
  const { data } = await llmCall({
    stage: "ingest.kit", tier: "kit_strong", system: prompt.body, user: kitUserMessage(opts.spec, pages, "", opts.geometry), images,
    schema: KitOutput, lookbookId: opts.lookbookId, timeoutMs: 420000, maxOutTokens: 32000,
  });
  return { kit: data, promptVersion: prompt.version, pages };
}

/** One targeted repair: previous kit + exact issues in, corrected kit out. Text-only (no images) to keep it cheap. */
export async function repairKit(opts: { spec: StyleSpec; kit: KitOutput; issues: string[]; lookbookId: number; stage: string; images?: Buffer[]; geometry?: string }): Promise<KitOutput> {
  const prompt = await loadPrompt("kit.md");
  const user = kitUserMessage(opts.spec, [], `## REPAIR\nThis is the current kit. Fix ONLY the listed problems, keep everything else identical, and return the COMPLETE corrected kit.\n\nProblems:\n${opts.issues.map((i) => `- ${i}`).join("\n")}\n\nCurrent kit:\n${JSON.stringify(opts.kit)}`, opts.geometry);
  const { data } = await llmCall({ stage: opts.stage, tier: "kit_strong", system: prompt.body, user, images: opts.images, schema: KitOutput, lookbookId: opts.lookbookId, timeoutMs: 420000, maxOutTokens: 32000 });
  return data;
}

/** Writes kit/ (css, per-archetype html, manifest, shell). Returns manifest. */
export async function writeKit(kitDir: string, spec: StyleSpec, kit: KitOutput, fontsCss: string, promptVersion: string): Promise<KitManifest> {
  const root = rootCss(spec);
  await fs.mkdir(path.join(kitDir, "archetypes"), { recursive: true });
  const css = [
    "/* generated: fonts + variables (deterministic), then element/layout CSS (LLM) */",
    fontsCss.replace(/url\(fonts\//g, "url(../fonts/"), root.css,
    "*{box-sizing:border-box;margin:0;padding:0}",
    kit.css,
  ].join("\n");
  await fs.writeFile(path.join(kitDir, "kit.css"), css);
  await fs.writeFile(path.join(kitDir, "kit.source.json"), JSON.stringify(kit));
  await fs.writeFile(path.join(kitDir, "shell.html"), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="kit.css"><body style="margin:0;background:#fff"><div id="root" style="width:1080px;height:1350px;position:relative;overflow:hidden"></div></body>`);
  const manifest: KitManifest = {
    promptVersion, vars: { colors: root.colors, fonts: root.fonts },
    families: { latin: [...new Set(spec.fonts.map((f) => f.google_fonts_family ?? f.family))], devanagari: [...new Set(spec.fonts.map((f) => f.devanagari_pair))] },
    furniture: Object.fromEntries(spec.layout.fixed_furniture.map((f) => [f.what, f.position])),
    margins: (() => { const m = spec.layout.margins_px; return typeof m === "number" ? { top: m, right: m, bottom: m, left: m } : m; })(),
    archetypes: [],
  };
  for (const a of spec.archetypes) {
    const k = kit.archetypes.find((x) => x.id === a.id);
    if (!k) continue;
    const file = `archetypes/${safe(a.id)}.html`;
    // archetype marker on the root element: lets deterministic fixes scope CSS overrides to one archetype
    const html0 = k.html; // text colour is judged on rendered pixels (polish), not on class names
    const html = /^\s*<\w+[^>]*\sdata-arch=/.test(html0) ? html0 : html0.replace(/^(\s*<\w+)/, `$1 data-arch="${a.id}"`);
    await fs.writeFile(path.join(kitDir, file), html);
    const sample: Record<string, string> = {};
    for (const s of a.slots) sample[s.name] = k.sample_slots[s.name] ?? (s.optional ? "" : s.name.toUpperCase()); // an optional slot with no sample renders empty, never as a placeholder word
    manifest.archetypes.push({ id: a.id, file, background_token: a.background_token, slots: a.slots.map((s) => ({ name: s.name, kind: s.kind, optional: s.optional, max_words: s.max_words, max_chars: s.max_chars })), sample_slots: sample });
  }
  await fs.writeFile(path.join(kitDir, "manifest.json"), JSON.stringify(manifest, null, 1));
  return manifest;
}
