# Influencer Signal Tracker

Scores Instagram finfluencer stock calls against real forward prices (vs SPY) and
visualizes accuracy. Multi-creator: adding a creator needs no code change — just run
the pipeline with a new handle.

## Setup

```bash
bun install
bunx playwright install chromium
cp .env.example .env   # then set GROQ_API_KEY
```

## Run the pipeline for a creator

```bash
bun run pipeline --handle <handle> --name "<Name>"
```

This scrapes → transcribes (Groq Whisper) → reads on-screen tickers (Groq vision) →
extracts explicit bullish calls (Groq LLM), then PAUSES.

- Log into Instagram in the launched Chromium window when it opens (the scrape needs
  an authenticated session; cookies persist in `.chrome-profile/`).
- After the pause, review `data/creators/<handle>/calls.review.md` and sanity-check
  the detected calls.
- Resume to fetch prices and score:

```bash
bun run pipeline --handle <handle> --name "<Name>" --from prices
```

Output: `data/creators/<handle>/dataset.json` and `data/creators/index.json`.

## View the dashboard

```bash
bun run dev   # http://localhost:3000
```

- `/` — list of tracked creators
- `/c/<handle>` — scorecard, calls timeline, analytics (gauge / bar / scatter / funnel)
- `/c/<handle>/ticker/<SYMBOL>` — price candlestick, stock-vs-SPY rebased line with call
  markers, and a forward-return table

## How accuracy is measured

Forward return from each reel's **post date** at 1w / 1m / 3m / since-call, reported as
**excess return vs SPY** so a rising market doesn't flatter a creator. Caveats (survivorship
bias, repost deduping, forward-from-post-date) are shown in-product.

See the design and plan in `../docs/superpowers/`.
