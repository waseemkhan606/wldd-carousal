import path from "node:path";
import fs from "node:fs";

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");

export function ensureDataDir(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  return DATA_DIR;
}

/**
 * Paths saved in the database are absolute. If the data folder moves (a new volume mount, a restored backup, another machine)
 * they would all dangle, so anything inside a "brands/" folder is re-based onto the current data folder when read.
 */
export function rebase(p: string | null | undefined): string | null {
  if (!p) return p ?? null;
  const base = DATA_DIR + path.sep;
  if (p.startsWith(base) || p === DATA_DIR) return p;
  const i = p.lastIndexOf(`${path.sep}brands${path.sep}`);
  return i >= 0 ? path.join(DATA_DIR, p.slice(i + 1)) : p;
}
