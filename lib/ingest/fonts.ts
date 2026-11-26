// Font-name normalisation + Google Fonts fetching. No brand knowledge.
import fs from "node:fs/promises";
import path from "node:path";
import type { RawFont } from "./pdf";

const WEIGHT_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300], [/regular|normal|book|roman/i, 400],
  [/medium/i, 500], [/semi-?bold|demi-?bold/i, 600], [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

// Generic OS/renderer fallback families that appear in PDFs for stray glyphs; they say nothing about the brand.
const SYSTEM_FALLBACK = /^(dejavu|liberation|arial|helvetica|times|courier|symbol|noto ?sans ?symbols|apple ?color|segoe|lucida|menlo|monaco|calibri|cambria)/i;

export type NormFont = { family: string; weights: number[]; raw: string[]; pages: number[]; type3: boolean; likelySystemFallback: boolean };

export function normaliseFontName(raw: string): { family: string; weight: number | null } {
  let n = raw.replace(/^[A-Z]{6}\+/, "");
  const [base, ...rest] = n.split("-");
  let tail = rest.join("-");
  // optical-size style suffixes like "9ptRegular" -> keep only the weight word
  tail = tail.replace(/\d+pt/gi, "");
  let family = base;
  // some foundries glue the style onto the family ("ArchivoBlack") with no hyphen
  let weight: number | null = null;
  for (const [re, w] of WEIGHT_WORDS) if (re.test(tail)) { weight = w; break; }
  if (weight == null) {
    for (const [re, w] of WEIGHT_WORDS) {
      const m = family.match(new RegExp(`(${re.source})$`, "i"));
      if (m && family.length > m[1].length + 2 && w !== 400) { weight = w; family = family.slice(0, -m[1].length); break; }
    }
  }
  // variable-font style axes are not part of the family name ("JostRoman", "InterVariable", "FooVF")
  family = family.replace(/(Roman|Variable|VF|Upright)$/, "") || family;
  family = family.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
  return { family, weight: weight ?? (/italic|oblique/i.test(tail) ? null : 400) };
}

export function normaliseFonts(raw: RawFont[]): NormFont[] {
  const by = new Map<string, NormFont>();
  for (const f of raw) {
    const { family, weight } = normaliseFontName(f.name);
    const e = by.get(family) ?? { family, weights: [], raw: [], pages: [], type3: false, likelySystemFallback: SYSTEM_FALLBACK.test(family.replace(/\s/g, "")) };
    if (weight && !e.weights.includes(weight)) e.weights.push(weight);
    if (!e.raw.includes(f.name)) e.raw.push(f.name);
    for (const p of f.pages) if (!e.pages.includes(p)) e.pages.push(p);
    e.type3 ||= f.type === "Type 3";
    by.set(family, e);
  }
  return [...by.values()].map((f) => ({ ...f, weights: f.weights.sort((a, b) => a - b), pages: f.pages.sort((a, b) => a - b) }));
}

// ---- Google Fonts ----
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type FetchedFont = { family: string; found: boolean; weights: number[]; css: string; files: string[]; error?: string };

/**
 * Download a family from Google Fonts into `dir` and return @font-face CSS pointing at local files.
 * We keep every unicode-range subset (latin, latin-ext, devanagari ...) so the browser picks per-character.
 * `cssUrlPrefix` is how the generated CSS refers to the files (e.g. "fonts/").
 */
export async function fetchGoogleFont(family: string, weights: number[], dir: string, cssUrlPrefix = "fonts/", fetchImpl: typeof fetch = fetch): Promise<FetchedFont> {
  const ws = [...new Set(weights.length ? weights : [400])].sort((a, b) => a - b);
  const q = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${ws.join(";")}&display=swap`;
  try {
    let res = await fetchImpl(q, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    let got = ws;
    if (res.status === 400) {
      // family may not offer every requested weight (or be a fixed-weight family): retry without axis, then with 400
      res = await fetchImpl(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=swap`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      got = [400];
    }
    if (!res.ok) return { family, found: false, weights: [], css: "", files: [], error: `HTTP ${res.status}` };
    const css = await res.text();
    await fs.mkdir(dir, { recursive: true });
    const files: string[] = [];
    const blocks = css.match(/@font-face\s*{[^}]+}/g) ?? [];
    const out: string[] = [];
    let i = 0;
    for (const b of blocks) {
      const url = /url\((https:[^)]+)\)/.exec(b)?.[1];
      if (!url) continue;
      const w = /font-weight:\s*(\d+)/.exec(b)?.[1] ?? "400";
      const sub = /\/\*\s*([\w-]+)\s*\*\//.exec(css.slice(Math.max(0, css.indexOf(b) - 40), css.indexOf(b)))?.[1] ?? `s${i}`;
      const fname = `${family.replace(/\s+/g, "")}-${w}-${sub}-${i++}.woff2`;
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      await fs.writeFile(path.join(dir, fname), Buffer.from(await r.arrayBuffer()));
      files.push(fname);
      out.push(b.replace(/url\(https:[^)]+\)/, `url(${cssUrlPrefix}${fname})`).replace(/\/\*[^*]*\*\//g, ""));
    }
    if (!files.length) return { family, found: false, weights: [], css: "", files: [], error: "no font files in CSS" };
    const present = [...new Set(out.map((b) => Number(/font-weight:\s*(\d+)/.exec(b)?.[1] ?? 400)))].sort((a, b) => a - b);
    return { family, found: true, weights: present.length ? present : got, css: out.join("\n"), files };
  } catch (e: any) {
    return { family, found: false, weights: [], css: "", files: [], error: e.message };
  }
}

/** Universal last-resort Devanagari family (covers every weight Google ships). Not a brand choice; flagged to the user. */
export const DEVANAGARI_FALLBACK = "Noto Sans Devanagari";

/**
 * A "devanagari pair" is only valid if Google actually ships a Devanagari subset for it.
 * LLMs happily name mono/Latin-only families here, so verify instead of trusting.
 */
export async function fetchDevanagariPair(pair: string, weights: number[], dir: string, fetchImpl: typeof fetch = fetch) {
  const hasDeva = (r: FetchedFont) => r.found && r.files.some((f) => /-devanagari-/.test(f));
  let r = await fetchGoogleFont(pair, weights, dir, "fonts/", fetchImpl);
  if (hasDeva(r)) return { family: pair, css: r.css, replaced: false, note: "" };
  const why = r.found ? "has no Devanagari glyphs" : `not found (${r.error})`;
  r = await fetchGoogleFont(DEVANAGARI_FALLBACK, weights, dir, "fonts/", fetchImpl);
  if (hasDeva(r)) return { family: DEVANAGARI_FALLBACK, css: r.css, replaced: true, note: `Devanagari pair "${pair}" ${why}; using ${DEVANAGARI_FALLBACK}. Pick a better match in the style review.` };
  return { family: pair, css: "", replaced: false, note: `No Devanagari font could be loaded (pair "${pair}" ${why}). Hindi slides will fail to render.` };
}
