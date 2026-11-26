# Carousel Studio: one-page note

```
 look book PDF ──► [code] anatomy parser ─► guideline register (page, quote, method)
        │                                         │
        ├──► [vision LLM] style spec ──reconcile──┘      (parsed facts override the model)
        │
        └──► measured geometry (positions, fonts, logo crop) ──► [LLM] template kit (HTML/CSS)
                      ▲                                              │ contrast fix · align · furniture rules
                      └──────── fidelity score (layout + pixels) ◄───┘   adaptive best-of-N
 ─────────────────────────────── stored per brand ───────────────────────────────
 topic ─► plan (code: cover, alternation, closer) ─► [LLM] copy JSON ─► validate (code)
       ─► render (Playwright) ─► [1 repair call] ─► cover director (4 alternatives, judged)
       ─► export PDF/PNG/ZIP ─► checklist (code + template + AI review) ─► 1 self-correction pass
```

**Why this shape.** A text-to-image model cannot hold exact brand typography, Devanagari shaping or word limits, so the model only writes JSON and code draws every pixel. Everything the PDF states exactly (sections, colours, fonts, rules) is parsed in code; the model is used only for understanding the design. Rules are checked on the *output*, not trusted from the prompt.

**Cost.** Ingest ≈ ₹70–90 once per brand (kit generation dominates; extra candidates only when the first scores below 75). A carousel ≈ ₹7–10. Text edits ₹0. Re-rendering after a template fix ₹0.

**Honest gaps.** Template fidelity depends on the look book (75–90). Some AI-judged rules are strict. Gemini fallback is lightly tested live.
