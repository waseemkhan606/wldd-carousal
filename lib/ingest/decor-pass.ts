// The skeleton is exact for text and boxes but cannot see decoration the PDF draws as effects (ruled paper, edges, stamp frames).
// One focused model call adds only that, as empty elements behind the content; compile keeps it only if the measured score improves.
import { z } from "zod";
import type { StyleSpec } from "./spec";
import { loadPrompt } from "./spec";
import { validateKitStatic, type KitOutput } from "./kit";
import { llmCall } from "../llm/router";

const DecorOutput = z.object({ archetypes: z.array(z.object({ id: z.string(), html: z.string().min(20) })), css_additions: z.string(), summary: z.string() });
export type DecorResult = { kit: KitOutput; summary: string; changed: string[] };

/** Returns the kit with decoration added, or null when the model had nothing valid to add. Throws on provider failure (the caller keeps the plain kit). */
export async function decorPass(opts: { spec: StyleSpec; kit: KitOutput; images: Buffer[]; imageIds: string[]; lookbookId: number; stage?: string }): Promise<DecorResult | null> {
  const { spec, kit } = opts;
  const prompt = await loadPrompt("kit_decor.md");
  const elements = spec.elements.filter((e) => e.enabled !== false).map((e) => `- ${e.id} (${e.kind}): ${e.description}${e.css_hint ? ` | css hint: ${e.css_hint}` : ""}${e.placement ? ` | placement: ${e.placement}` : ""}${e.rotation_deg ? ` | rotation ${e.rotation_deg}deg` : ""}`).join("\n");
  const user = [
    `## Brand decorative elements (from the look book)\n${elements || "(none listed: judge from the pictures)"}`,
    `## Pictures\nIn this order, left = current render, right = reference: ${opts.imageIds.join(", ")}.`,
    `## Palette variables\n${spec.colors.map((c) => `--c-${c.token}`).join(", ")}\n## Font variables\n${spec.fonts.map((f) => `--font-${f.role}`).join(", ")}`,
    `## Kit CSS (read-only; add through css_additions)\n\`\`\`css\n${kit.css}\n\`\`\``,
    `## Templates\n${kit.archetypes.map((a) => `### ${a.id} (background ${spec.archetypes.find((x) => x.id === a.id)?.background_token})\n\`\`\`html\n${a.html}\n\`\`\``).join("\n\n")}`,
  ].join("\n\n");
  const ask = async (extra = "") => (await llmCall({ stage: opts.stage ?? "ingest.decor", tier: "kit_strong", system: prompt.body, user: user + extra, images: opts.images, schema: DecorOutput, lookbookId: opts.lookbookId, timeoutMs: 420000, maxOutTokens: 16000 })).data;
  const apply = (e: z.infer<typeof DecorOutput>): KitOutput => {
    const next: KitOutput = JSON.parse(JSON.stringify(kit));
    for (const a of e.archetypes) { const t = next.archetypes.find((x) => x.id === a.id); if (t) t.html = a.html; }
    if (e.css_additions.trim()) next.css = `${next.css}\n/* decoration */\n${e.css_additions.trim()}\n`;
    return next;
  };
  let e = await ask(), next = apply(e), problems = validateKitStatic(next, spec);
  if (problems.length) { e = await ask(`\n\n## Your previous answer broke these rules. Return a corrected answer:\n${problems.map((p) => `- ${p}`).join("\n")}`); next = apply(e); problems = validateKitStatic(next, spec); }
  if (problems.length) return null;
  // the text layer must be untouched: every data-slot / data-furniture opening tag is byte-identical to before
  const sig = (h: string) => (h.match(/<[^>]*\sdata-(?:slot|furniture)=[^>]*>/g) ?? []).join("");
  const changed = e.archetypes.map((a) => a.id).filter((id) => kit.archetypes.some((x) => x.id === id));
  for (const id of changed) if (sig(kit.archetypes.find((x) => x.id === id)!.html) !== sig(next.archetypes.find((x) => x.id === id)!.html)) return null;
  return changed.length || e.css_additions.trim() ? { kit: next, summary: e.summary, changed } : null;
}
