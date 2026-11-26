// Deterministic parser for the look book document anatomy:
//   Profile · Brand system (colours, elements, type, pillars) · one page per post format · carousel cover ·
//   "inside the carousel" (slide plan bullets + voice) · logo page.
// It reads text BLOCKS with coordinates (pdftotext -bbox-layout), so tables come out as real columns. Keyed on the
// section headings every look book shares, never on brand words. Free, exact and testable offline.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Ln = { x: number; y: number; x1: number; y1: number; text: string };
export type Block = { page: number; x: number; y: number; x1: number; y1: number; text: string; lines: Ln[]; used?: string };
export type PageKind = "profile" | "brand_system" | "post" | "carousel_cover" | "carousel_inside" | "logo" | "other";
export type Anatomy = {
  pages: { page: number; kind: PageKind; title: string; blocks: number }[];
  concept?: string; // e.g. the idea named in the brand-system page title
  profile: { handle?: string; name?: string; tagline: string[]; highlights: string[]; feedRules: string[]; page?: number } | null;
  colours: { name: string; hex: string; roles: string[]; usage: string; page: number }[];
  elements: { name: string; modifier: string; rotation?: number; placement?: string; caption: string; page: number }[];
  type: { family: string; weights: number[]; roles: string[]; caption: string; page: number }[];
  pillars: { name: string; description: string; label: string; kind: "single" | "carousel"; page: number }[];
  cadence?: string;
  posts: { page: number; pillar: string; width: number; height: number; sample: string[] }[];
  carousel: { slides?: number; motto?: string; coverPage?: number; coverLabel?: string; insidePage?: number; title?: string; insideSample: string[]; coverSample: string[] } | null;
  rules: { text: string; atoms: string[]; page: number }[];
  voice: { text: string; sentences: string[]; page: number } | null;
  logo: { rule: string; description?: string; usage?: string; page: number } | null;
  unmapped: { page: number; text: string }[];
  coverage: { blocks: number; mapped: number };
  warnings: string[];
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s: string) => decode(s).replace(/\s+/g, " ").trim();
const num = (s: string) => Number(s);


type W = { x0: number; x1: number; t: string };
/**
 * Tracked (letter-spaced) text extracts as one "word" per letter. Rebuild the words from the gaps: a gap clearly wider
 * than the typical letter gap is a word space. Normal lines are returned untouched.
 */
export function rejoin(words: W[], em = 11): string {
  const single = words.filter((w) => w.t.length <= 2).length;
  if (words.length < 6 || single / words.length < 0.55) {
    // ordinary text: a gap well under a word space (kerning pairs the extractor split) is not a space
    let o = words[0]?.t ?? "";
    for (let k = 1; k < words.length; k++) o += (words[k].x0 - words[k - 1].x1 < 0.16 * em ? "" : " ") + words[k].t;
    return o;
  }
  const gaps = words.slice(1).map((w, i) => w.x0 - words[i].x1).sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)] || 0.1;
  const thr = med + 0.21 * em; // a word space is the letter gap plus roughly a quarter em
  let out = words[0].t;
  for (let k = 1; k < words.length; k++) out += (words[k].x0 - words[k - 1].x1 > thr ? " " : "") + words[k].t;
  return out;
}

export async function readBlocks(pdf: string): Promise<{ blocks: Block[]; widths: Record<number, number>; pageCount: number }> {
  const xml = (await run("pdftotext", ["-bbox-layout", pdf, "-"], { maxBuffer: 64 * 1024 * 1024 })).stdout;
  const blocks: Block[] = [], widths: Record<number, number> = {};
  let page = 0;
  for (const m of xml.matchAll(/<page width="([\d.]+)" height="[\d.]+">([\s\S]*?)<\/page>/g)) {
    page++; widths[page] = num(m[1]);
    for (const b of m[2].matchAll(/<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/block>/g)) {
      const lines: Ln[] = [];
      for (const l of b[5].matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)) {
        const ws = [...l[5].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((w) => ({ x0: num(w[1]), y0: num(w[2]), x1: num(w[3]), y1: num(w[4]), t: decode(w[5]) }));
        // pdftotext glues text from different columns that share a baseline: split at wide horizontal gaps
        const em = Math.max(6, (num(l[4]) - num(l[2])) / 1.3), segs: (typeof ws)[] = [];
        let cur: typeof ws = [];
        for (const w of ws) {
          const pv = cur[cur.length - 1];
          // new segment on a wide gap, or when the baseline / glyph size jumps (a different text run sharing the line)
          if (pv && (w.x0 - pv.x1 > Math.max(26, em * 3.2) || Math.abs(w.y0 - pv.y0) > 3 || Math.abs((w.y1 - w.y0) - (pv.y1 - pv.y0)) > 4)) { segs.push(cur); cur = []; }
          cur.push(w);
        }
        if (cur.length) segs.push(cur);
        for (const sg of segs) {
          const text = clean(rejoin(sg.map((w) => ({ x0: w.x0, x1: w.x1, t: w.t })), em));
          if (text) lines.push({ x: sg[0].x0, y: Math.min(...sg.map((w) => w.y0)), x1: sg[sg.length - 1].x1, y1: Math.max(...sg.map((w) => w.y1)), text });
        }
      }
      const text = clean(lines.map((l) => l.text).join(" "));
      if (text) blocks.push({ page, x: num(b[1]), y: num(b[2]), x1: num(b[3]), y1: num(b[4]), text, lines });
    }
  }
  return { blocks, widths, pageCount: page };
}

const BULLET = /^[▸▹►•▪‣\-–]\s+/;
const isCaps = (t: string) => /[A-Z]/.test(t) && t === t.toUpperCase();
const lineBlock = (l: Ln, page: number): Block => ({ page, x: l.x, y: l.y, x1: l.x1, y1: l.y1, text: l.text, lines: [l] });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Split one rule bullet into atomic, individually checkable statements. */
export function atomise(bullet: string): string[] {
  const parts = bullet.replace(BULLET, "").split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let prefix = "";
  for (const p of parts) {
    // "Slide 1: ... · 2–4: ..." : the second part inherits "Slide(s)"
    const m = /^(\d+)\s*[–-]\s*(\d+)\s*:/.exec(p);
    let part = p;
    if (m && /^slide\s*\d/i.test(parts[0])) part = `Slides ${p}`;
    else if (m) part = `Slides ${p}`;
    // furniture lists: "Tag top-left, slide count top-right, logo bottom-right on every slide"
    const pos = part.match(/\b(top|bottom|middle)[- ](left|right|centre|center)\b/gi) ?? [];
    if (pos.length >= 2 && part.includes(",")) {
      const suffix = /\bon every slide\b|\bon every post\b|\bon each slide\b/i.exec(part)?.[0] ?? "";
      for (const piece of part.replace(/\s*(on every slide|on every post|on each slide)\s*$/i, "").split(/\s*,\s*/)) if (piece) out.push(`${piece.trim()}${suffix ? " " + suffix : ""}`);
      continue;
    }
    // "no stock photos, no faces"
    if (/^no\b/i.test(part) && part.includes(",")) { for (const piece of part.split(/\s*,\s*/)) if (piece) out.push(/^no\b/i.test(piece) ? piece : `no ${piece}`); continue; }
    out.push(part);
    prefix = "";
  }
  void prefix;
  return out.map((s) => s.replace(/^[a-z]/, (c) => c.toUpperCase()));
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);

export function parseAnatomy(all: Block[], widths: Record<number, number>, pageCount: number): Anatomy {
  const a: Anatomy = { pages: [], profile: null, colours: [], elements: [], type: [], pillars: [], posts: [], carousel: null, rules: [], voice: null, logo: null, unmapped: [], coverage: { blocks: all.length, mapped: 0 }, warnings: [] };
  const mark = (b: Block, why: string) => { b.used = why; };
  const byPage = (p: number) => all.filter((b) => b.page === p).sort((x, y) => x.y - y.y || x.x - y.x);

  for (let p = 1; p <= pageCount; p++) {
    const bs = byPage(p), W = widths[p] ?? 810;
    const first = (re: RegExp) => bs.find((b) => re.test(b.text));
    let kind: PageKind = "other", title = bs[0]?.text ?? "";
    if (first(/HOW IT LOOKS ON/i)) kind = "profile";
    else if (first(/^BRAND SYSTEM\b/i) || first(/^BRAND COLOU?RS$/i)) kind = "brand_system";
    else if (first(/^POST\s*·/i)) kind = "post";
    else if (first(/^CAROUSEL\s*·\s*SLIDE\s*\d+/i)) kind = "carousel_cover";
    else if (first(/^CAROUSEL\s*·\s*\d+\s*SLIDES?/i)) kind = "carousel_inside";
    else if (first(/^LOGO\b/i)) kind = "logo";
    a.pages.push({ page: p, kind, title, blocks: bs.length });

    // ---- bullets & voice can sit on any page ----
    for (const b of bs) if (BULLET.test(b.text) && b.text.length > 12) { const atoms = atomise(b.text); a.rules.push({ text: b.text.replace(BULLET, ""), atoms, page: p }); mark(b, "rule"); }
    const voiceH = bs.find((b) => /^VOICE$/i.test(b.text));
    if (voiceH) {
      mark(voiceH, "voice");
      const body = bs.filter((b) => b.y > voiceH.y && b.y - voiceH.y < 160 && !isCaps(b.text) && !BULLET.test(b.text));
      if (body.length) { const text = body.map((b) => b.text).join(" "); body.forEach((b) => mark(b, "voice")); a.voice = { text, sentences: sentences(text), page: p }; }
    }

    if (kind === "profile") {
      const prof = { tagline: [] as string[], highlights: [] as string[], feedRules: [] as string[], handle: undefined as string | undefined, name: undefined as string | undefined, page: p };
      bs.forEach((b) => mark(b, "profile"));
      const ls = bs.flatMap((b) => b.lines).sort((x, y) => x.y - y.y || x.x - y.x);
      prof.handle = ls.find((l) => /^@?[a-z0-9_]+\.[a-z0-9_.]+$/i.test(l.text))?.text;
      const feed = ls.find((l) => /^FEED\s*:/i.test(l.text));
      if (feed) prof.feedRules = feed.text.replace(/^FEED\s*:\s*/i, "").split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);
      // name + tagline: the tight cluster of lines right after the stats row ("posts / followers / following")
      const stat = ls.findIndex((l) => /^following$/i.test(l.text));
      const start = ls.findIndex((l, i) => i > stat && stat >= 0 && !/^[\d.,]+[KkMm]?$/.test(l.text) && !/^(posts|followers|following)$/i.test(l.text));
      if (start >= 0) {
        const cluster = [ls[start]];
        for (let i = start + 1; i < ls.length; i++) { const gap = ls[i].y - cluster[cluster.length - 1].y1; if (gap > 26 || /^(Follow|Message)\b/i.test(ls[i].text)) break; cluster.push(ls[i]); }
        prof.name = cluster[0].text; prof.tagline = cluster.slice(1).map((l) => l.text);
      }
      // highlights: the first row (same y) of plain words below the buttons / tagline
      const after = ls.filter((l) => l.y > (ls[start]?.y ?? 0) + 40);
      const rows = new Map<number, Ln[]>();
      for (const l of after) { const k = Math.round(l.y / 8); (rows.get(k) ?? rows.set(k, []).get(k)!).push(l); }
      for (const row of [...rows.values()].sort((x, y) => x[0].y - y[0].y)) { const r = row.filter((l) => /^[A-Za-z][A-Za-z ]{2,20}$/.test(l.text) && !isCaps(l.text) && !/^(Follow|Message)$/i.test(l.text)); if (r.length >= 3 && r.length === row.length) { prof.highlights = r.sort((x, y) => x.x - y.x).map((l) => l.text); break; } }
      a.profile = prof;
    }

    if (kind === "brand_system") {
      const ls = bs.flatMap((b) => b.lines.map((l) => ({ l, b }))).sort((x, y) => x.l.y - y.l.y || x.l.x - y.l.x);
      const H = (re: RegExp) => ls.find((o) => re.test(o.l.text))?.l;
      const hc = H(/^BRAND COLOU?RS$/i), he = H(/^ELEMENTS$/i), ht = H(/^(TYPE|TYPOGRAPHY|FONTS)$/i), hp = H(/^((CONTENT )?PILLARS|FORMATS|CONTENT FORMATS)\b/i);
      const heads = [hc, he, ht, hp].filter((x): x is Ln => !!x).sort((x, y) => x.y - y.y);
      const markLine = (l: Ln, why: string) => { const o = ls.find((q) => q.l === l); if (o) mark(o.b, why); };
      for (const h of heads) markLine(h, "heading");
      const range = (from?: Ln) => { if (!from) return [] as Ln[]; const to = heads.find((h) => h.y > from.y); return ls.map((o) => o.l).filter((l) => l.y > from.y + 1 && (!to || l.y < to.y - 1)); };
      const gapOk = (up: Ln, dn: Ln) => dn.y - up.y1 < 16;

      // COLOURS: "#HEX · usage" lines; the usage may wrap onto following lines of the same column; the name is above
      const cs = range(hc);
      for (const hx of cs.filter((l) => /#[0-9a-f]{6}\b/i.test(l.text))) {
        const hex = /#([0-9a-f]{6})\b/i.exec(hx.text)![1].toUpperCase();
        const usageParts = [hx.text.replace(/#[0-9a-f]{6}\s*·?\s*/i, "").trim()];
        let last = hx;
        for (const l of cs.filter((q) => q.y > hx.y && Math.abs(q.x - hx.x) < 12).sort((x, y) => x.y - y.y)) { if (!gapOk(last, l) || /#[0-9a-f]{6}/i.test(l.text)) break; usageParts.push(l.text); last = l; markLine(l, "colour"); }
        const nameL = cs.filter((q) => q.y < hx.y && Math.abs(q.x - hx.x) < 12 && isCaps(q.text) && !/#/.test(q.text)).sort((x, y) => y.y - x.y)[0];
        const usage = usageParts.join(" ").replace(/\s+/g, " ").trim();
        a.colours.push({ name: nameL?.text ?? `COLOUR ${a.colours.length + 1}`, hex: "#" + hex, roles: usage.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean), usage, page: p });
        markLine(hx, "colour"); if (nameL) markLine(nameL, "colour");
      }
      cs.forEach((l) => markLine(l, "colour-art"));

      // ELEMENTS: per column, the bottom-most contiguous run of lines is the caption (rows above are artwork text)
      const es = range(he), cols: Ln[][] = [];
      for (const l of [...es].sort((x, y) => x.x - y.x)) { const c = cols.find((col) => Math.abs(col[0].x - l.x) < 14); c ? c.push(l) : cols.push([l]); }
      const runs = cols.sort((x, y) => x[0].x - y[0].x).map((col) => {
        const sorted = col.sort((x, y) => y.y - x.y), run = [sorted[0]];
        for (const l of sorted.slice(1)) if (gapOk(l, run[0])) run.unshift(l); else break;
        return run;
      });
      const captionRow = Math.max(0, ...runs.map((r) => r[r.length - 1].y));
      for (const run of runs.filter((r) => captionRow - r[r.length - 1].y < 30)) { // artwork-only columns sit on higher rows
        const cap = run.map((l) => l.text).join(" "), [name, ...rest] = cap.split(/\s*,\s*/), modifier = rest.join(", ");
        const rot = /([−–-]?\s?\d+(?:\.\d+)?)\s*°/.exec(cap);
        a.elements.push({ name: name.trim(), modifier, rotation: rot ? num(rot[1].replace(/[−–]/g, "-").replace(/\s/g, "")) : undefined, placement: /\b(top|bottom|left|right|centre|center|middle)\b[\w/-]*/i.exec(modifier || name)?.[0], caption: cap, page: p });
      }
      es.forEach((l) => markLine(l, "element"));

      // TYPE: spec captions live in the right-hand column and start at a "FAMILY · ROLES" line; wrapped roles continue below
      const ts = range(ht), minX = (widths[p] ?? 810) * 0.42, caps: Ln[][] = [];
      for (const l of ts.filter((q) => q.x > minX).sort((x, y) => x.y - y.y || x.x - y.x)) {
        const prev = caps[caps.length - 1], joined = prev?.map((q) => q.text).join(" ") ?? "";
        // a caption continues while it has no "·" yet, or its last line ends with "·" or ","; otherwise a new one starts
        if (prev && l.y - prev[prev.length - 1].y1 < 16 && (!joined.includes("·") || /[·,]$/.test(prev[prev.length - 1].text) || /^·/.test(l.text))) prev.push(l); else caps.push([l]);
      }
      for (const c of caps) {
        const text = c.sort((x, y) => x.y - y.y || x.x - y.x).map((l) => l.text).join(" ").replace(/\s+·/g, " ·"), [fam, roles] = text.split(/\s*·\s*/);
        const w = (/(\d{3}(?:\/\d{3})*)/.exec(fam)?.[1] ?? "").split("/").filter(Boolean).map(Number);
        a.type.push({ family: fam.replace(/\s*\d{3}(?:\/\d{3})*\s*$/, "").trim(), weights: w, roles: (roles ?? "").split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean), caption: text, page: p });
      }
      ts.forEach((l) => markLine(l, "type"));

      // PILLARS: rows of [name][description][label]
      if (hp) {
        const cad = hp.text.split(/\s+·\s+/)[1]; if (cad) a.cadence = cad;
        const rows = new Map<number, Ln[]>();
        for (const l of range(hp)) { const k = Math.round(l.y / 10); (rows.get(k) ?? rows.set(k, []).get(k)!).push(l); }
        for (const row of [...rows.values()].sort((x, y) => x[0].y - y[0].y)) {
          const r = row.sort((x, y) => x.x - y.x);
          if (r.length < 2) continue;
          const label = r.length >= 3 ? r[r.length - 1].text : "";
          a.pillars.push({ name: r[0].text, description: r.length >= 3 ? r.slice(1, -1).map((l) => l.text).join(" ") : r[1].text, label, kind: /carousel/i.test(label + r[1].text) ? "carousel" : "single", page: p });
          r.forEach((l) => markLine(l, "pillar"));
        }
      }
      const sys = bs.find((b) => /^BRAND SYSTEM\b/i.test(b.text));
      if (sys) { mark(sys, "title"); a.concept = sys.text.split(/\s+·\s+/)[1]; }
      bs.filter((b) => !b.used && b.y < 120 && /^[A-Z]/.test(b.text)).forEach((b) => mark(b, "title"));
    }

    if (kind === "post") {
      const h = first(/^POST\s*·/i)!, m = /^POST\s*·\s*(.+?)\s*·\s*(\d+)\s*[×x]\s*(\d+)/i.exec(h.text);
      mark(h, "post-header");
      const sample = bs.filter((b) => b !== h && b.y > h.y).map((b) => { mark(b, "sample"); return b.text; });
      a.posts.push({ page: p, pillar: m?.[1] ?? h.text, width: m ? num(m[2]) : 1080, height: m ? num(m[3]) : 1350, sample });
    }
    if (kind === "carousel_cover") {
      const h = first(/^CAROUSEL\s*·\s*SLIDE\s*\d+/i)!, m = /SLIDE\s*(\d+)\s*(?:\(([^)]*)\))?/i.exec(h.text);
      mark(h, "post-header");
      const sample = bs.filter((b) => b !== h && b.y > h.y).map((b) => { mark(b, "sample"); return b.text; });
      a.carousel = { ...(a.carousel ?? { insideSample: [] }), coverPage: p, coverLabel: m?.[2], coverSample: sample, insideSample: a.carousel?.insideSample ?? [] };
    }
    if (kind === "carousel_inside") {
      const h = first(/^CAROUSEL\s*·\s*\d+\s*SLIDES?/i)!, m = /(\d+)\s*SLIDES?\s*(?:·\s*(.+))?/i.exec(h.text);
      mark(h, "post-header");
      const sample = bs.filter((b) => !b.used && b.y > h.y && b.y < (bs.find((x) => BULLET.test(x.text))?.y ?? 99999) - 1).map((b) => { mark(b, "sample"); return b.text; });
      const ttl = bs[0] && bs[0] !== h ? bs[0].text : undefined; if (ttl) mark(bs[0], "title");
      a.carousel = { ...(a.carousel ?? { coverSample: [] }), slides: m ? num(m[1]) : undefined, motto: m?.[2], insidePage: p, title: ttl, insideSample: sample, coverSample: a.carousel?.coverSample ?? [] };
    }
    if (kind === "logo") {
      const lb = first(/^LOGO\b/i)!, parts = lb.text.split(/\s+·\s+/);
      mark(lb, "logo");
      a.logo = { rule: lb.text, description: parts.length > 2 ? parts[1] : undefined, usage: parts[parts.length - 1], page: p };
    }
    // headings / credits that carry no guideline
    for (const b of bs) if (!b.used && b.page === p && (/^SAMPLE LOOK BOOK\b/i.test(b.text) || /^@?[\w.]+$/.test(b.text) && kind === "logo")) mark(b, "credit");
    if (kind === "other" || kind === "logo") bs.filter((b) => !b.used && b.y < 80).forEach((b) => mark(b, "title"));
  }

  // coverage + warnings
  for (const b of all) if (!b.used && /[\p{L}\p{N}]/u.test(b.text)) a.unmapped.push({ page: b.page, text: b.text }); else if (!b.used) b.used = "symbol";
  a.coverage.mapped = all.length - a.unmapped.length;
  if (!a.colours.length) a.warnings.push("No colour table found (expected 'BRAND COLOURS' with '#HEX · usage').");
  if (!a.type.length) a.warnings.push("No typography captions found (expected 'FAMILY · ROLES').");
  if (!a.pillars.length) a.warnings.push("No content pillars table found.");
  if (!a.rules.length) a.warnings.push("No rule bullets (▸) found.");
  if (!a.voice) a.warnings.push("No VOICE section found.");
  if (!a.elements.length) a.warnings.push("No elements captions found.");
  return a;
}

export async function analyseLookbook(pdf: string): Promise<Anatomy> {
  const { blocks, widths, pageCount } = await readBlocks(pdf);
  return parseAnatomy(blocks, widths, pageCount);
}
export { slug as anatomySlug };
