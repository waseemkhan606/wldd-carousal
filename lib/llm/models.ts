// Default model per tier. IDs verified against GET https://openrouter.ai/api/v1/models on 2026-11-25.
// Stable (non-preview) IDs chosen on purpose; every tier is overridable in Settings.
export type Tier = "kit_strong" | "vision_strong" | "text_strong" | "text_cheap" | "vision_cheap";
export type ModelPair = { openrouter: string; gemini: string };

export const DEFAULT_MODELS: Record<Tier, ModelPair> = {
  // building the HTML/CSS template kit from the look book: layout reasoning is where weaker models produce broken slides
  kit_strong: { openrouter: "google/gemini-2.5-pro", gemini: "gemini-2.5-pro" }, // Opus 5.5 was tried: no better (see DECISIONS.md)
  vision_strong: { openrouter: "google/gemini-2.5-pro", gemini: "gemini-2.5-pro" },
  // copy writing, repair, regeneration and cover direction: this is the quality-critical per-carousel call (budget: up to Rs 10 / carousel)
  text_strong: { openrouter: "google/gemini-2.5-pro", gemini: "gemini-2.5-pro" },
  text_cheap: { openrouter: "google/gemini-2.5-flash", gemini: "gemini-2.5-flash" },
  vision_cheap: { openrouter: "google/gemini-2.5-flash", gemini: "gemini-2.5-flash" } // flash-lite was too lenient as a design judge (scored a left/centre alignment mismatch 95),
};
