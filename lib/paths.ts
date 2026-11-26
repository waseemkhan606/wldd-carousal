import path from "node:path";
import fs from "node:fs";

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");

export function ensureDataDir(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  return DATA_DIR;
}
