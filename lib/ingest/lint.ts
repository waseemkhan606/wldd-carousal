import type { StyleSpec } from "./spec";

/** Cross-reference checks the zod shape can't express. Returns human-readable warnings; never throws. */
export function lintSpec(s: StyleSpec): string[] {
  const w: string[] = [];
  const colors = new Set(s.colors.map((c) => c.token));
  const arch = new Map(s.archetypes.map((a) => [a.id, a]));
  const bgs = new Set(s.archetypes.map((a) => a.background_token));
  for (const a of s.archetypes) if (!colors.has(a.background_token)) w.push(`Archetype "${a.id}" uses unknown colour token "${a.background_token}".`);
  for (const r of [...s.sequencing, ...s.rules]) {
    const m = r.machine; if (!m) continue;
    const p = m.params as any;
    if (m.type === "position_archetype" && !arch.has(p.archetype_id)) w.push(`Rule "${"rule" in r ? r.rule : r.text}" points at missing archetype "${p.archetype_id}".`);
    if (m.type === "alternate_background") for (const t of p.tokens ?? []) if (!bgs.has(t)) w.push(`Sequencing rule alternates to "${t}" but no archetype has that background, so the rule can't be followed. Add an archetype or edit the rule.`);
    if (m.type === "color_only_on") {
      if (!colors.has(p.color_token)) w.push(`Rule uses unknown colour "${p.color_token}".`);
      for (const t of p.background_tokens ?? []) if (!colors.has(t)) w.push(`Rule references unknown background "${t}".`);
    }
    if (m.type === "forbid" && typeof p.pattern === "string") {
      try { new RegExp(p.pattern, "u"); } catch { w.push(`Forbid pattern "${p.pattern}" is not a valid regex.`); }
    }
  }
  const hasCover = s.archetypes.some((a) => /cover/i.test(a.purpose + a.id)), hasCloser = s.archetypes.some((a) => /clos|cta|outro/i.test(a.purpose + a.id));
  if (!hasCover) w.push("No cover-type archetype found; the first slide will reuse a body archetype.");
  if (!hasCloser) w.push("No closer-type archetype found; the last slide will reuse a body archetype.");
  return w;
}
