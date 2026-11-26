// Deterministic colour extraction: hex codes from text + k-means on rendered pages. No brand knowledge.
export type HexHit = { hex: string; context: string; page: number };

export function hexFromText(texts: string[]): HexHit[] {
  const hits: HexHit[] = [];
  texts.forEach((t, i) => {
    const lines = t.split("\n");
    lines.forEach((line, li) => {
      for (const m of line.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        // the label usually sits on the line above, the usage on the same line
        const above = (lines[li - 1] ?? "").trim();
        hits.push({ hex: "#" + m[1].toUpperCase(), context: [above, line.trim()].filter(Boolean).join(" | ").replace(/\s{2,}/g, " ").slice(0, 200), page: i + 1 });
      }
    });
  });
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.hex) ? false : (seen.add(h.hex), true)));
}

export type PpmImage = { w: number; h: number; data: Uint8Array };
export function parsePpm(buf: Buffer): PpmImage {
  // P6\n<w> <h>\n255\n<bytes>
  let pos = 0;
  const tok = () => {
    while (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09) pos++;
    if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; return tok(); }
    const s = pos;
    while (pos < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[pos])) pos++;
    return buf.toString("ascii", s, pos);
  };
  if (tok() !== "P6") throw new Error("not a P6 PPM");
  const w = Number(tok()), h = Number(tok());
  tok();
  pos++;
  return { w, h, data: buf.subarray(pos) };
}

export type Swatch = { hex: string; share: number };
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** k-means over pixels pooled from several images (deterministic: fixed init + stride sampling). */
export function kmeansPalette(images: PpmImage[], k = 8, maxSamples = 60000): Swatch[] {
  const px: number[] = [];
  for (const im of images) {
    const n = im.w * im.h;
    const stride = Math.max(1, Math.floor((n * images.length) / maxSamples));
    for (let i = 0; i < n; i += stride) px.push(im.data[i * 3], im.data[i * 3 + 1], im.data[i * 3 + 2]);
  }
  const N = px.length / 3;
  if (!N) return [];
  // k-means++-like deterministic init: farthest-point from the mean
  const cent: number[][] = [[px[0], px[1], px[2]]];
  const d2 = (i: number, c: number[]) => (px[i * 3] - c[0]) ** 2 + (px[i * 3 + 1] - c[1]) ** 2 + (px[i * 3 + 2] - c[2]) ** 2;
  const minD = new Float64Array(N).fill(Infinity);
  while (cent.length < k) {
    let best = -1, bd = -1;
    const last = cent[cent.length - 1];
    for (let i = 0; i < N; i++) {
      minD[i] = Math.min(minD[i], d2(i, last));
      if (minD[i] > bd) { bd = minD[i]; best = i; }
    }
    if (bd < 25) break;
    cent.push([px[best * 3], px[best * 3 + 1], px[best * 3 + 2]]);
  }
  const assign = new Int32Array(N);
  for (let it = 0; it < 12; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < N; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) { const d = d2(i, cent[c]); if (d < bd) { bd = d; bi = c; } }
      assign[i] = bi;
      const s = sum[bi]; s[0] += px[i * 3]; s[1] += px[i * 3 + 1]; s[2] += px[i * 3 + 2]; s[3]++;
    }
    cent.forEach((c, ci) => { const s = sum[ci]; if (s[3]) { c[0] = s[0] / s[3]; c[1] = s[1] / s[3]; c[2] = s[2] / s[3]; } });
  }
  // Snap each centroid to the most frequent exact colour in its cluster. Averages blur flat brand colours
  // (two similar pastels merge into a third colour that appears nowhere); the mode is the real colour.
  const counts = new Array(cent.length).fill(0);
  const modes = cent.map(() => new Map<number, number>());
  for (let i = 0; i < N; i++) {
    const c = assign[i];
    counts[c]++;
    const key = (px[i * 3] << 16) | (px[i * 3 + 1] << 8) | px[i * 3 + 2];
    modes[c].set(key, (modes[c].get(key) ?? 0) + 1);
  }
  return cent.map((c, i) => {
    let best = -1, bn = 0;
    for (const [k, n] of modes[i]) if (n > bn) { bn = n; best = k; }
    return { hex: best >= 0 ? toHex(best >> 16, (best >> 8) & 255, best & 255) : toHex(c[0], c[1], c[2]), share: counts[i] / N };
  }).filter((s) => s.share > 0.002).sort((a, b) => b.share - a.share);
}
