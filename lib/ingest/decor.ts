// Decoration lines (margin rules, dividers): detected in the rendered slide and the reference crop, compared, and fixed
// with an archetype-scoped CSS override. Deterministic: no LLM. The aligner handles text; this handles what it can't.
import sharp from "sharp";

export type VLine = { x: number; thick: number; color: string; run: number };
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/**
 * Thin (<=8px) vertical lines spanning most of the slide. Per column: the dominant colour and how many rows it covers.
 * A line column is one whose dominant colour differs from the background and covers >= minRunFrac of the rows, while
 * the same colour covers little of the columns 7px to one side. Colour-based, so text touching the line can't hide it.
 */
export async function verticalLines(png: Buffer, minRunFrac = 0.6): Promise<VLine[]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const q = (o: number) => ((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3);
  const hist: Map<number, number>[] = [];
  const dom = new Int32Array(W), cov = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const m = new Map<number, number>();
    for (let y = 0; y < H; y++) { const k = q((y * W + x) * 3); m.set(k, (m.get(k) ?? 0) + 1); }
    hist.push(m);
    let bk = -1, bn = 0; for (const [k, n] of m) if (n > bn) { bn = n; bk = k; }
    dom[x] = bk; cov[x] = bn;
  }
  const rgb = (k: number) => [((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3];
  const far = (a: number, b: number) => { const x = rgb(a), y = rgb(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) > 70; };
  // the slide's background = the colour most columns are dominated by; a line is a column dominated by something else
  const votes = new Map<number, number>(); for (let x = 0; x < W; x++) votes.set(dom[x], (votes.get(dom[x]) ?? 0) + 1);
  const gbg = [...votes].sort((a, b) => b[1] - a[1])[0][0];
  const isLine = new Uint8Array(W);
  for (let x = 10; x < W - 10; x++) {
    if (cov[x] < H * minRunFrac || !far(dom[x], gbg)) continue;
    const side = (xx: number) => (hist[xx].get(dom[x]) ?? 0);
    if (Math.min(side(x - 7), side(x + 7)) > H * 0.3) continue; // wide block, not a thin line
    isLine[x] = 1;
  }
  const out: VLine[] = [];
  for (let x = 10; x < W - 10; x++) {
    if (!isLine[x]) continue;
    let x1 = x; while (x1 + 1 < W - 10 && isLine[x1 + 1]) x1++;
    if (x1 - x + 1 <= 8) { const mid = Math.round((x + x1) / 2), c = rgb(dom[mid]); out.push({ x: (x + x1) / 2, thick: x1 - x + 1, color: hex(c[0] + 4, c[1] + 4, c[2] + 4), run: cov[mid] }); }
    x = x1;
  }
  return out;
}

const cd = (a: string, b: string) => [1, 3, 5].reduce((s, i) => s + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0);

/** Pair each reference line with the nearest rendered line (position error is a defect whatever the colour). */
export function diffLines(ref: VLine[], got: VLine[]): { fromX: number; dx: number; ref: VLine; got: VLine }[] {
  const out: { fromX: number; dx: number; ref: VLine; got: VLine }[] = [];
  const free = [...got];
  for (const r of ref) {
    const k = free.map((m, i) => ({ m, i })).filter(({ m }) => Math.abs(m.x - r.x) <= 220).sort((a, b) => Math.abs(a.m.x - r.x) - Math.abs(b.m.x - r.x))[0];
    if (!k) continue;
    free.splice(k.i, 1);
    if (Math.abs(k.m.x - r.x) > 3) out.push({ fromX: k.m.x, dx: Math.round(r.x - k.m.x), ref: r, got: k.m });
  }
  return out;
}

/** Opacity that turns the rendered line colour into the reference line colour over the background (1 = same). */
export function lineOpacity(refColor: string, gotColor: string, bg: string): number {
  const c = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  let best = 0, p = 1;
  for (const i of [1, 3, 5]) { const span = c(bg, i) - c(gotColor, i); if (Math.abs(span) > Math.abs(best)) { best = span; p = (c(bg, i) - c(refColor, i)) / span; } }
  return Math.max(0.1, Math.min(1, Math.round(p * 100) / 100));
}

function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) { if (s[i] === "(") depth++; else if (s[i] === ")" && --depth === 0) return i; }
  return -1;
}
const scope = (selector: string, id: string) => selector.trim().replace(/^(\s*[.#]?[\w-]+)/, `$1[data-arch="${id}"]`);

/**
 * Find the rule that draws a vertical line near `fromX` (a hard-stop `to right`/`90deg` gradient, or a thin absolutely
 * positioned element) and return an override rule, scoped to one archetype, that moves it by dx. "" if none found.
 */
export function verticalLineOverride(css: string, fromX: number, dx: number, archetypeId: string, opacity = 1): string {
  const lo = fromX - 4, hi = fromX + 7;
  const outs: string[] = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim(), body = m[2];
    if (!selector || selector.includes(",") || /^[\d%]/.test(selector)) continue;
    // 1) gradient line: shift the px stops that sit at the line
    for (const decl of body.split(";")) {
      const c = decl.indexOf(":"); if (c < 0) continue;
      const prop = decl.slice(0, c).trim(), val = decl.slice(c + 1);
      if (!/^background(-image)?$/.test(prop)) continue;
      let next = val, changed = false, from = 0;
      for (;;) {
        const gi = next.indexOf("linear-gradient(", from); if (gi < 0) break;
        const open = gi + "linear-gradient".length, end = closeParen(next, open); if (end < 0) break;
        const call = next.slice(gi, end + 1);
        if (/\(\s*(to right|90deg)/.test(call)) {
          let moved = call.replace(/(-?\d+(?:\.\d+)?)px/g, (t, n) => (+n >= lo && +n <= hi ? `${Math.round(+n + dx)}px` : t));
          // a faded reference line: blend the line colour with transparency instead of using it at full strength
          if (opacity < 0.93) moved = moved.replace(/var\(--[\w-]+\)/g, (v) => `color-mix(in srgb, ${v} ${Math.round(opacity * 100)}%, transparent)`);
          if (moved !== call) { next = next.slice(0, gi) + moved + next.slice(end + 1); changed = true; from = gi + moved.length; continue; }
        }
        from = end + 1;
      }
      if (changed) outs.push(`${scope(selector, archetypeId)} { ${prop}: ${next.trim()}; }`);
    }
    // 2) thin element: width <= 6px with left near the line
    const w = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/.exec(body), l = /(?:^|;)\s*left\s*:\s*(-?\d+(?:\.\d+)?)px/.exec(body);
    if (w && l && +w[1] <= 6 && +l[1] >= lo && +l[1] <= hi && /position\s*:\s*absolute/.test(body)) outs.push(`${scope(selector, archetypeId)} { left: ${Math.round(+l[1] + dx)}px; }`);
  }
  return outs.join("\n");
}
