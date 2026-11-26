import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "../paths";

const g = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (g.__db) return g.__db;
  ensureDataDir();
  const d = new Database(path.join(DATA_DIR, "app.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(fs.readFileSync(path.join(process.cwd(), "lib/db/schema.sql"), "utf8"));
  try { d.exec("ALTER TABLE slides ADD COLUMN render_json TEXT"); } catch { /* column already exists */ }
  g.__db = d;
  return d;
}
