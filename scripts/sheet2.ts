import sharp from "sharp";
(async () => { const dir = process.argv[2], ids = process.argv.slice(3); const tiles = await Promise.all(ids.map((i) => sharp(`${dir}/${i}.png`).resize(360, 450).png().toBuffer()));
  await sharp({ create: { width: 370 * ids.length, height: 450, channels: 3, background: "#777" } }).composite(tiles.map((input, i) => ({ input, left: i * 370, top: 0 }))).png().toFile(`${dir}/sheet.png`); })();
