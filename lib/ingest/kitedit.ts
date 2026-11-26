// Change a template by instruction: the owner says what is wrong, a model edits only the affected templates' HTML plus appended CSS,
// the edit is validated against the kit rules, saved into the raw kit, and the free polish/measure pipeline re-runs on top of it.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { getBrand, getLookbook, lookbookDir } from "../db/repo";
import { StyleSpec, loadPrompt } from "./spec";
import { KitOutput, validateKitStatic } from "./kit";
import { compileKit } from "./compile";
import { llmCall } from "../llm/router";
import { assertCredits } from "../llm/preflight";
import type { Progress } from "./run";
import { kitFiles, readJson, type KitEditRecord } from "./kitlog";

const EditOutput = z.object({
  archetypes: z.array(z.object({ id: z.string(), html: z.string().min(20) })).min(1),
  css_additions: z.string(),
  summary: z.string(),
});

const files = kitFiles;

export const kitDirOf = (lookbookId: number) => { const lb = getLookbook(lookbookId); if (!lb) throw new Error("Look book not found"); return path.join(lookbookDir(getBrand(lb.brand_id)!.slug, lb.version), "kit"); };

export async function editHistory(lookbookId: number): Promise<{ edits: KitEditRecord[]; canUndo: boolean }> {
  const f = files(kitDirOf(lookbookId));
  return { edits: await readJson<KitEditRecord[]>(f.log, []), canUndo: await fs.access(f.undo).then(() => true, () => false) };
}

async function rawKit(kitDir: string): Promise<KitOutput> {
  const f = files(kitDir);
  for (const p of [f.raw, path.join(kitDir, "kit.source.json")]) { const k = await readJson<KitOutput | null>(p, null); if (k?.css && k.archetypes?.length) return k; }
  throw new Error("This look book has no saved template to edit. Rebuild the templates first.");
}

export async function editTemplates(lookbookId: number, opts: { archetype?: string; instruction: string }, progress: Progress = () => {}): Promise<{ summary: string; archetypes: string[]; score: number }> {
  const instruction = opts.instruction.trim();
  if (instruction.length < 4) throw new Error("Write what should change, for example: \"make the quiz option text bigger\".");
  const lb = getLookbook(lookbookId); if (!lb?.spec_json) throw new Error("Look book not found");
  const spec = StyleSpec.parse(JSON.parse(lb.spec_json)), kitDir = kitDirOf(lookbookId), f = files(kitDir);
  await assertCredits(0.15, "this template change");
  const kit = await rawKit(kitDir);
  const targets = opts.archetype && opts.archetype !== "all" ? kit.archetypes.filter((a) => a.id === opts.archetype) : kit.archetypes;
  if (!targets.length) throw new Error("That template was not found.");

  progress("edit", "Reading the template and your instruction");
  const prompt = await loadPrompt("kit_edit.md");
  const images: Buffer[] = [];
  for (const a of targets.slice(0, 3)) { const b = await fs.readFile(path.join(kitDir, "previews", `${a.id}.png`)).catch(() => null); if (b) images.push(b); }
  const slotsOf = (id: string) => spec.archetypes.find((x) => x.id === id)?.slots.map((s) => `${s.name} (${s.kind})`).join(", ") ?? "";
  const user = [
    `## Instruction\n${instruction}`,
    `## Templates to change${opts.archetype && opts.archetype !== "all" ? "" : " (the instruction may apply to some or all of them: change only those it concerns)"}`,
    targets.map((a) => `### ${a.id}\nSlots: ${slotsOf(a.id)}\n\`\`\`html\n${a.html}\n\`\`\``).join("\n\n"),
    `## Kit CSS (read-only context; add overrides through css_additions)\n\`\`\`css\n${kit.css}\n\`\`\``,
    `## Palette variables\n${spec.colors.map((c) => `--c-${c.token}`).join(", ")}\n## Font variables\n${spec.fonts.map((x) => `--font-${x.role}`).join(", ")}`,
    images.length ? `Images attached: how the template(s) above look now, in the same order.` : "",
  ].filter(Boolean).join("\n\n");

  const ask = async (extra = "") => (await llmCall({ stage: "ingest.kit_edit", tier: "kit_strong", system: prompt.body, user: user + extra, images, schema: EditOutput, lookbookId, timeoutMs: 240000, maxOutTokens: 12000 })).data;
  const apply = (e: z.infer<typeof EditOutput>): KitOutput => {
    const next: KitOutput = JSON.parse(JSON.stringify(kit));
    for (const a of e.archetypes) { const t = next.archetypes.find((x) => x.id === a.id); if (t) t.html = a.html; }
    if (e.css_additions.trim()) next.css = `${next.css}\n/* edit: ${instruction.replace(/\*\//g, "").slice(0, 80)} */\n${e.css_additions.trim()}\n`;
    return next;
  };
  progress("edit", "Making the change");
  let edit = await ask(), next = apply(edit), problems = validateKitStatic(next, spec);
  if (problems.length) { progress("edit", "Fixing a rule the change broke"); edit = await ask(`\n\n## Your previous answer broke these rules. Return a corrected answer:\n${problems.map((p) => `- ${p}`).join("\n")}`); next = apply(edit); problems = validateKitStatic(next, spec); }
  if (problems.length) throw new Error(`The change could not be made safely (${problems[0]}). Nothing was changed; try describing it differently.`);

  // save: keep the previous raw kit for undo, record the edit, then re-run the free polish/measure steps on top
  const changed = edit.archetypes.map((a) => a.id).filter((id) => kit.archetypes.some((x) => x.id === id));
  await fs.writeFile(f.undo, JSON.stringify(kit));
  await fs.writeFile(f.raw, JSON.stringify(next));
  const log = await readJson<KitEditRecord[]>(f.log, []);
  log.push({ at: new Date().toISOString(), archetypes: changed, instruction, summary: edit.summary });
  await fs.writeFile(f.log, JSON.stringify(log, null, 1));
  progress("edit", "Applying the change and re-checking the templates");
  const rep = await compileKit(lookbookId, progress, { reuse: true });
  return { summary: edit.summary, archetypes: changed, score: rep.score };
}

/** Undo the last instruction: restore the raw kit saved before it. */
export async function undoEdit(lookbookId: number, progress: Progress = () => {}): Promise<{ undone: string }> {
  const kitDir = kitDirOf(lookbookId), f = files(kitDir);
  const prev = await readJson<KitOutput | null>(f.undo, null); if (!prev) throw new Error("Nothing to undo.");
  const log = await readJson<KitEditRecord[]>(f.log, []), last = log.pop();
  await fs.writeFile(f.raw, JSON.stringify(prev)); await fs.rm(f.undo, { force: true }); await fs.writeFile(f.log, JSON.stringify(log, null, 1));
  progress("edit", "Restoring the previous templates");
  await compileKit(lookbookId, progress, { reuse: true });
  return { undone: last?.instruction ?? "" };
}
