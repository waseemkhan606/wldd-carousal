// Platform profiles live in config, not in any brand. Visuals are identical; only override slots differ.
export type PlatformId = "instagram" | "linkedin";
export const PLATFORMS: Record<PlatformId, { label: string; hook: string; closer: string; caption: string; maxHashtags: number }> = {
  instagram: {
    label: "Instagram",
    hook: "punchy, curiosity-driven, scroll-stopping",
    closer: "a swipe/save style call to action such as 'Save this' (in the brand's voice)",
    caption: "short and conversational, can use line breaks, 5-12 relevant hashtags",
    maxHashtags: 15,
  },
  linkedin: {
    label: "LinkedIn",
    hook: "slightly more professional and insight-led, still in the brand's voice",
    closer: "a follow/comment call to action (e.g. invite a comment or a follow), not 'Save this'",
    caption: "2-4 short paragraphs, professional but human, 3-5 hashtags",
    maxHashtags: 5,
  },
};
export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];
export const LANGUAGES = { en: "English", hi: "Hindi (Devanagari)", hinglish: "Hinglish" } as const;
