import { describe, it, expect } from "vitest";
import { chromium } from "playwright";

// Devanagari must be shaped by a real text engine: conjuncts join and vowel signs attach. A drawn-by-model or
// naive glyph-by-glyph render would keep the pieces apart. We measure that a conjunct is narrower than its
// pieces forced apart with a zero-width non-joiner, in a real browser.
describe("devanagari shaping", () => {
  it("joins conjuncts (क्ष, त्र) instead of laying out loose letters", async () => {
    const b = await chromium.launch();
    try {
      const p = await b.newPage();
      await p.setContent(`<body style="font:48px 'Noto Sans Devanagari','Devanagari Sangam MN','Kohinoor Devanagari',sans-serif"><span id=a>क्षत्रिय</span><br><span id=b>क्‌षत्‌रिय</span></body>`);
      const w = await p.evaluate(() => [document.getElementById("a")!.getBoundingClientRect().width, document.getElementById("b")!.getBoundingClientRect().width]);
      expect(w[0]).toBeGreaterThan(0);
      expect(w[0]).toBeLessThan(w[1]);
    } finally { await b.close(); }
  }, 60000);
});
