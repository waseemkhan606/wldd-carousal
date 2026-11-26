# Carousel Studio

Upload a brand's look book (a PDF) once. The studio reads it, saves it, and anyone with the access token can then create on-brand **Instagram and LinkedIn carousels, and single posts such as a quiz**, from a topic. Every result is checked against every rule in the look book.

## What it does

1. **Brands.** Create a brand and upload its look book. Ingestion runs once (about 3 to 6 minutes, roughly ₹40 to ₹90):
   - the PDF's structure (profile, colours, type, post formats, cover, inside slides, logo) is parsed in code;
   - a vision model reads the design, and an HTML/CSS **template kit** is built from the measured geometry of the look book's own sample posts;
   - automatic fixes run on the kit (margins, stamps, ruled paper, edge elements, readable colours), then its fidelity to the look book is scored.

   The **Guidelines** tab lists every rule found, with its page and verbatim quote. The **Templates** tab shows each template with a quality score, a free "Re-polish" button, and **"Fix a template with instructions"**: describe what is wrong ("make the quiz options bigger") and that template is edited in place for a few rupees, with undo, instead of rebuilding everything.
2. **Create.** Pick a brand, a topic, a language (English, हिंदी, Hinglish) and either a **carousel** (3 to 10 slides) or a **single post** (e.g. the look book's quiz). A carousel costs about ₹8 to ₹13.
3. **Result.** Instagram PDF and PNG ZIP, LinkedIn PDF (1080×1350), captions, and the cost. The side panel is an **adherence checklist**: each guideline with its status, evidence and the look book page. Edit any text inline (₹0), regenerate one slide without touching the others, or delete a carousel.

## Principles

- No image model draws text. All typography is real HTML/CSS from validated JSON, and Devanagari is shaped by the browser's text engine.
- No hard-coded brand styles: everything comes from the look book (a test searches the code for brand names, fonts and colours).
- Where the look book's written rules and its sample artwork disagree, the written rule wins.
- Keys never live in the repository. They are saved encrypted on the server, in Settings.

## Run locally

Requirements: Node 22+, [pnpm](https://pnpm.io), [poppler](https://poppler.freedesktop.org) (`brew install poppler` or `apt install poppler-utils`), and Chromium for Playwright.

```bash
pnpm install
pnpm exec playwright install chromium
APP_ACCESS_TOKEN=choose-a-token pnpm dev        # http://localhost:3000
```

Open the app, sign in with the token, then **Settings** and paste an OpenRouter key (primary) and/or a Gemini key (fallback). Without `APP_ACCESS_TOKEN`, a random token is printed once in the server console on first boot, and only its hash is stored.

Runtime data (SQLite database, look books, templates, carousels, encrypted keys) lives in `DATA_DIR` (default `./data`, ignored by git).

## Deploy on Railway

The app needs a long-running Node process, a persistent disk, poppler and Chromium, so it ships as a Docker image (`Dockerfile`) with a `railway.json`.

1. In Railway: **New Project → Deploy from GitHub repo** and pick this repository. Railway builds the `Dockerfile`, and every push to `main` redeploys automatically.
2. **Add a Volume** to the service and mount it at `/data`. The database, look books and carousels live here, so without a volume everything is lost on every redeploy.
3. **Variables:**
   - `APP_ACCESS_TOKEN`: the shared token that gates the whole app (choose a long random one);
   - `DATA_DIR=/data` (already the image default);
   - `TRUST_PROXY=1`, so the login rate limiter sees real client IPs behind Railway's proxy.
4. **Settings → Networking → Generate Domain.** The health check is `/api/health`.
5. Open the domain, sign in with the token, go to **Settings** and add your OpenRouter or Gemini key.

Give the service at least 2 GB of memory: Chromium renders every slide.

### Docker locally

```bash
docker build -t carousel-studio .
docker run --rm -p 3000:3000 -e APP_ACCESS_TOKEN=choose-a-token -v carousel-data:/data carousel-studio
```

## Models and cost

Tiers are set in **Settings** (OpenRouter model IDs, with Gemini direct as the fallback):

| Tier | Default | Used for |
|---|---|---|
| `vision_strong` | Gemini 2.5 Pro | reading the look book (once per brand) |
| `kit_strong` | Gemini 2.5 Pro | building the slide templates (once per brand) |
| `text_strong` | Gemini 2.5 Pro | copy, repair, regeneration, cover direction |
| `text_cheap` / `vision_cheap` | Gemini 2.5 Flash | checklist review, fidelity judging, picking the best cover |

Costs come from OpenRouter's reported cost (the Gemini fallback is priced from the table in Settings), shown in rupees and dollars before and after every run. The app checks that your key has enough credit **before** starting a paid step, and a failed or interrupted ingest never pays twice: the saved spec and templates are reused.

## Tests

```bash
pnpm test                       # unit tests: parser, guidelines, validators, auth, polish, no-hard-coding, Devanagari shaping
pnpm e2e                        # live end to end on the fixtures (spends real credits)
npx tsx scripts/ui-walkthrough.ts   # browser walkthrough with mocked failures
```

## Project map

```
app/            Next.js pages and API routes (brands, create, carousel, settings, auth)
components/     UI building blocks and the adherence checklist panel
lib/ingest/     look book reading, guideline register, template kit build, automatic polish
lib/generate/   planning, copy generation, validation, cover director, checklist
lib/render/     Playwright slide renderer, exports (PDF, ZIP, captions)
lib/llm/        OpenRouter and Gemini clients, router, pricing, credit preflight
lib/prompts/    the prompts, versioned
fixtures/       three sample look books used by tests
DECISIONS.md    design decisions and trade-offs;  NOTE.md  one-page pipeline note
```

## Known limits

- Look books must follow the standard document layout (profile, brand system, post formats, carousel cover, inside slides, logo). Free-form PDFs are not supported.
- Template quality depends on the model's drawing of the look book, so two ingests of the same PDF can differ (fidelity roughly 60 to 90). The automatic fixes catch most defects, "Re-polish" is free, and "Rebuild from scratch" is a paid retry.
- Raster textures cannot be tuned automatically. The Gemini direct fallback is implemented but lightly tested live.
- AI-reviewed guidelines (tone, "one idea per slide") can be strict; they are labelled as AI-checked.
