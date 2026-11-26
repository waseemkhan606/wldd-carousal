# Carousel Studio

Upload a brand's look book (PDF) once. The studio reads it, saves it, and anyone with the access token can then create on-brand Instagram and LinkedIn carousels from a topic, checked against every rule in the look book.

## Run it

```bash
pnpm install
npx playwright install chromium     # slide renderer
brew install poppler                # pdftotext / pdftoppm (Linux: apt install poppler-utils)
APP_ACCESS_TOKEN=choose-a-token pnpm build && APP_ACCESS_TOKEN=choose-a-token pnpm start   # http://localhost:3000
```

Without `APP_ACCESS_TOKEN` a random token is printed once in the console on first boot (only its scrypt hash is stored).
Then open **Settings** and paste an OpenRouter key (primary) and/or a Gemini key (fallback). Keys are stored encrypted in `data/`, never in the repo or in logs.

Data lives in `DATA_DIR` (default `./data`): SQLite, uploaded PDFs, template kits, generated carousels.

## How it works

1. **Brands**: create a brand, upload its look book PDF. Ingest runs once (about ₹70–90, 3–6 minutes):
   the PDF structure is parsed in code, a vision model reads the design, a template kit (HTML/CSS per slide type) is built from the *measured* geometry of the look book's sample posts, and its fidelity is scored. The **Guidelines** tab shows every rule found, with the page and a verbatim quote, and how each is enforced. The **Templates** tab shows a quality verdict and a rebuild button.
2. **Create**: pick a brand, a topic, 3–10 slides, a language (English / हिंदी / Hinglish) and optionally a format. One carousel costs about ₹7–10 (shown before and after).
3. **Result**: Instagram PDF + PNG ZIP, LinkedIn PDF (1080×1350), captions, cost. The side panel is the **adherence checklist**: each guideline with its status, evidence and the look book page. Edit any text inline (₹0) or regenerate one slide without touching the others.

## Principles

- No image model draws text. Typography is real HTML/CSS from validated JSON; Devanagari is shaped by the browser's text engine.
- No hard-coded brand styles: everything comes from the look book (a test greps the code for brand names, fonts and colours).
- Written rules beat sample artwork where the two disagree.
- Models: ingest uses a strong vision model; copy, repair and cover direction use a strong text model; checks and judging use a cheap flash model. Change tiers in Settings.

## Tests

`pnpm test` (unit: parser, guidelines, validators, auth, no-hard-coding, Devanagari shaping, renderer) · `pnpm e2e` (live: ingest + generate on the fixtures, costs real money) · `npx tsx scripts/ui-walkthrough.ts` (browser walkthrough, mocked failures).

## Known limits

- Look books must follow the standard anatomy (profile, brand system, post formats, carousel cover, inside slides, logo). Free-form PDFs are not supported.
- Template fidelity varies with the look book (typically 75–90). Templates the look book never draws (e.g. a closing slide) are built from the written rules only.
- Raster textures cannot be tuned automatically. The Gemini direct fallback is implemented but only lightly tested live.
- AI-reviewed guidelines (tone, "one idea per slide") can be strict or wrong; they are labelled as AI-checked.

## Access token

Set `APP_ACCESS_TOKEN` to choose your own. Behind a reverse proxy set `TRUST_PROXY=1`. Rotate from Settings (not possible when the token comes from the environment). Test: `./scripts/auth-live-test.sh`.

AI tools used while building: Claude Code (Anthropic).
