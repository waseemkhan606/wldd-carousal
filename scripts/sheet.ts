import sharp from "sharp"; import fs from "node:fs"; import path from "node:path";
(async () => {
  for (const slug of process.argv.slice(2)) {
    const dir = path.join("samples/kit", slug);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png") && !f.startsWith("_")).sort();
    const W = 360, H = 450, gap = 14;
    const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(path.join(dir, f)).resize(W, H).png().toBuffer(), left: i * (W + gap), top: 0 })));
    await sharp({ create: { width: files.length * (W + gap) - gap, height: H, channels: 3, background: "#777" } }).composite(tiles).png().toFile(path.join(dir, "_sheet.png"));
    console.log(slug, files.join(" "));
  }
})();
