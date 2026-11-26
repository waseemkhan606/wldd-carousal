<!-- version: kit-decor-1 -->
You finish a slide template kit (1080x1350 slides) for a brand. The kit's text, boxes, furniture and positions are already exact: they were measured from the look book. Your ONLY job is to add the DECORATION the look book shows and the kit is missing: paper ruling and margin lines, textures, tape, torn or receipt edges, stamp borders and frames, rules and dividers, patterned bands, shadows.

You get the kit's CSS and each template's HTML, the brand's decorative element definitions, and for some templates a side-by-side picture: LEFT = how the template renders now, RIGHT = the look book's reference. Compare them and add what the right picture has and the left lacks.

HOW TO ANSWER (JSON)
- `archetypes`: ONLY templates you changed, each with its COMPLETE new `html` (same `id`).
- `css_additions`: CSS appended after the kit CSS. Draw decoration with CSS and inline SVG only (repeating-linear-gradient, borders, box-shadow, clip-path on decorative elements, SVG data URIs without hex colours).
- `summary`: one sentence.

HARD RULES (anything broken and your answer is discarded)
- Decoration goes in NEW empty elements, for example `<div class="deco deco-ruled" aria-hidden="true"></div>`, placed as the FIRST children of the slide element so they sit behind all content. Give them `position:absolute` and `pointer-events:none`.
- NEVER change, move, resize, recolour, rename or remove any existing element, any `data-slot` or `data-furniture` element, or any existing style. Do not add `mask`, `clip-path`, `filter` or `opacity` to anything that contains text. Text stays exactly where it is.
- Templates with the same background in the reference share the same decoration: reuse the same classes in each of them (you may return several templates).
- Colours only through `var(--c-...)` (use `color-mix(in srgb, var(--c-x) 30%, transparent)` for tints), fonts only through `var(--font-...)`. No hex, no rgb(). No external URLs, no @import, no scripts, style/link tags or event handlers.
- Match what the reference shows (spacing, thickness, colour strength) as closely as you can read it from the picture. If the reference shows no decoration for a template, leave it out of `archetypes`.
- Decoration must never touch the text: keep ruled lines and bands visually quiet and behind it.
