// The record of instruction edits made to a template kit (kept next to the kit, separate from the compile code to avoid an import cycle).
import fs from "node:fs/promises";
import path from "node:path";

export type KitEditRecord = { at: string; archetypes: string[]; instruction: string; summary: string };
export const kitFiles = (kitDir: string) => ({ raw: path.join(kitDir, "kit.raw.json"), undo: path.join(kitDir, "kit.raw.undo.json"), log: path.join(kitDir, "kit.edits.json") });
export const readJson = async <T>(f: string, d: T): Promise<T> => { try { return JSON.parse(await fs.readFile(f, "utf8")) as T; } catch { return d; } };

/** Templates the owner has edited by hand: the automatic aligner must not pull them back towards the look book's sample. */
export async function editedTemplates(kitDir: string): Promise<Set<string>> {
  return new Set((await readJson<KitEditRecord[]>(kitFiles(kitDir).log, [])).flatMap((r) => r.archetypes));
}
