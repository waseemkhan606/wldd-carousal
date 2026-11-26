import { extractDeterministic } from "../lib/ingest/extract";
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
const pdf = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-"));
extractDeterministic(pdf, dir).then((x) => {
  const { pagePngs, texts, ...rest } = x;
  console.log(JSON.stringify({ ...rest, pages: pagePngs.length, textChars: texts.map((t) => t.length) }, null, 1));
});
