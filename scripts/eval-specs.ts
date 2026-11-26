// Hand-written specs shaped like the ones the vision model produces (names differ from the skeleton's own roles on purpose).
export type S = [string, string, boolean?]; // name, kind, optional
export const slot = (n: S) => ({ name: n[0], kind: n[1], max_words: 24, max_chars: 160, optional: !!n[2] });
const OPTS: S[] = [["option_a", "option"], ["option_b", "option"], ["option_c", "option"], ["option_d", "option"]];
// archetype: id, purpose, page, frame index, slots
export const SPECS: Record<string, [string, string, number, number, S[]][]> = {
  "Brutal Dev": [
    ["command", "single post", 3, 0, [["kicker", "tag"], ["command_name", "headline"], ["tagline", "subhead"], ["explanation", "body"], ["example", "body"], ["stamp_text", "stamp_text"]]],
    ["quiz", "single post", 4, 0, [["kicker", "tag"], ["question", "headline"], ...OPTS]],
    ["cover", "cover", 5, 0, [["kicker", "tag"], ["headline", "headline"], ["stamp_text", "stamp_text"], ["subtitle", "body"], ["swipe", "cta", true]]],
    ["inside_light", "inside", 6, 0, [["kicker", "tag"], ["headline", "number"], ["body", "body"]]],
    ["inside_dark", "inside", 6, 1, [["kicker", "tag"], ["headline", "number"], ["body", "body"]]],
    ["closer", "closer", 6, 2, [["kicker", "tag"], ["headline", "number"], ["body", "body"], ["cta", "cta", true]]],
  ],
  "Maison Lune": [
    ["ritual", "single post", 3, 0, [["kicker", "tag"], ["number", "number"], ["subhead", "subhead"], ["body", "body"], ["maths", "body"], ["stamp_text", "stamp_text"]]],
    ["quiz", "single post", 4, 0, [["kicker", "tag"], ["question", "headline"], ...OPTS, ["footnote", "body", true]]],
    ["cover", "cover", 5, 0, [["kicker", "tag"], ["headline", "headline"], ["stamp_text", "stamp_text"], ["subtitle", "body"], ["swipe", "cta", true]]],
    ["inside_rose", "inside", 6, 0, [["kicker", "tag"], ["headline", "number"], ["body", "body"], ["stamp_text", "stamp_text", true]]],
    ["inside_oat", "inside", 6, 1, [["kicker", "tag"], ["headline", "number"], ["body", "body"], ["stamp_text", "stamp_text", true]]],
    ["closer", "closer", 6, 2, [["kicker", "tag"], ["headline", "number"], ["body", "body"], ["stamp_text", "stamp_text", true]]],
  ],
  "Small Print": [
    ["number_post", "single post", 3, 0, [["kicker", "tag"], ["number", "number"], ["subhead", "subhead"], ["body", "body"], ["maths", "body"], ["stamp_text", "stamp_text"]]],
    ["quiz", "single post", 4, 0, [["kicker", "tag"], ["quiz_badge", "tag", true], ["question", "headline"], ...OPTS, ["footnote", "body"]]],
    ["cover", "cover", 5, 0, [["kicker", "tag"], ["headline", "headline"], ["stamp_text", "stamp_text"], ["subtitle", "body"], ["swipe", "cta", true]]],
    ["inside_paper", "inside", 6, 0, [["headline", "number"], ["line_one", "body"], ["line_two", "body"]]],
    ["inside_green", "inside", 6, 1, [["headline", "number"], ["line_one", "body"], ["line_two", "body"]]],
    ["closer", "closer", 6, 2, [["headline", "headline"], ["stamp_text", "stamp_text", true], ["body", "body", true]]],
  ],
};
