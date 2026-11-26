import sharp from "sharp";
const [dir, ...ids] = process.argv.slice(2);
(async () => { for (const n of ids) {
  const parts = await Promise.all([`${n}.ref.png`, `${n}.png`, `${n}.long.png`].map((f) => sharp(`${dir}/${f}`).resize(360, 450).png().toBuffer()));
  await sharp({ create: { width: 1100, height: 450, channels: 3, background: "#888" } }).composite(parts.map((input, i) => ({ input, left: i * 370, top: 0 }))).png().toFile(`${dir}/${n}.cmp.png`);
} })();
