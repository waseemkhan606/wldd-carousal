# Carousel Studio: one container with everything the pipeline needs (Node, poppler for reading PDFs, Chromium for drawing slides).
FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data

# poppler-utils: pdftotext / pdftoppm / pdftocairo / pdftohtml / pdffonts / pdfimages / pdfinfo
# fonts-noto-core: a Devanagari-capable fallback so Hindi text always shapes, even before a brand's own fonts are fetched
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils fonts-noto-core ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN pnpm exec playwright install --with-deps chromium

COPY . .
RUN pnpm build

ENV NODE_ENV=production
VOLUME ["/data"]
EXPOSE 3000
# Railway injects PORT; locally it falls back to 3000
CMD ["sh", "-c", "pnpm exec next start -H 0.0.0.0 -p ${PORT:-3000}"]
