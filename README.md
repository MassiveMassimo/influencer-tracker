# Influencer Signal Tracker

Scores Instagram **and X/Twitter** finfluencer stock calls against real forward prices
(vs SPY) and visualizes accuracy. Multi-creator and platform-agnostic: both pipelines emit
the same `ReelCall` contract, so adding a creator needs no code change — just run the
pipeline with a new handle.

## Setup

```bash
bun install
bunx playwright install chromium   # Instagram scrape only
cp .env.example .env   # then set GEMINI_API_KEY (vision + extract) and RETTIWT_API_KEY (X)
```

## Run the pipeline for a creator

```bash
bun run pipeline   --handle <handle> --name "<Name>"   # Instagram posts
bun run pipeline:x --handle <handle> --name "<Name>"   # X/Twitter (text-first)
```

The Instagram pipeline collects reels, feed posts, and carousels. It transcribes video
audio with self-hosted Parakeet, reads captions and images with Gemini vision, extracts
explicit bullish calls with Gemini, then PAUSES. Use `--months <n>` to change the
12-month collection window.
The X pipeline scrapes tweets → extracts (Gemini), then PAUSES.

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

Forward return from each post's **post date** at 1w / 1m / 3m / since-call, reported as
**excess return vs SPY** so a rising market doesn't flatter a creator. Caveats (survivorship
bias, repost deduping, forward-from-post-date) are shown in-product.

See the design and plans in `docs/superpowers/`.
