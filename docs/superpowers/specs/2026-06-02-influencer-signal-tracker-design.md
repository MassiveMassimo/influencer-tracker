# Influencer Signal Tracker — Design

**Date:** 2026-06-02
**Status:** Draft for review

## Goal

Measure how accurate stock-picking Instagram finfluencers are at calling stocks.
For each tracked creator, scrape ~12 months of reels, detect every explicit
bullish stock call, and evaluate each call against real forward price action (vs
SPY). Surface the result as an interactive dashboard: per-creator timeline of calls
plus per-ticker price charts with call markers and an accuracy scorecard.

The question we are answering: **when a creator tells viewers to buy, what happens next?**

First creator seeded: **@kevvonz** (Kevin Hu). The system is multi-creator from the
start — creator handle is a parameter, never hardcoded — so adding more people is
just another pipeline run.

## Scope

- Multi-creator capable; seeded with `@kevvonz`. Adding a creator = run the
  pipeline with a new handle.
- Last 12 months of reels per creator (rolling from run date).
- "Call" = a reel where the creator names a ticker **and** explicitly recommends
  buying or holding it. Market commentary, neutral mentions, and bearish notes are
  recorded but excluded from the accuracy scorecard.
- Accuracy = forward return from **reel post date** at 1w / 1m / 3m / since-call,
  expressed as **excess return vs SPY** over the same window.

## Non-goals

- No live/continuous monitoring — pipeline runs manually on demand.
- No trading, no portfolio simulation, no position sizing.
- No auth, no multi-user, no deployment target beyond local `bun dev`.

### Deferred (not now, but designed not to block)

- **Cross-creator leaderboard / head-to-head comparison.** Designed for (data is
  creator-keyed, dashboard is creator-aware) but the comparison UI is not built
  until a second creator exists. No speculative comparison views for n=1.

## Repository restructure (Phase 0)

This repo currently holds only the Python trading pipeline at root. The user wants
a monorepo. Verified safe on this machine: no `data/` symlink, no installed
systemd units, no unit references this repo path — this is a dev checkout, not the
production systemd host.

Target layout:

```
stonks/                      # monorepo root
├── stock-pipeline-v2/       # existing Python code, moved wholesale
│   ├── src/ tests/ schema/ spec/ docs/ config/ systemd/ ...
│   ├── pyproject.toml uv.lock CLAUDE.md README.md AGENTS.md ...
├── influencer-tracker/      # new Bun/TS project (this spec)
├── docs/superpowers/specs/  # monorepo-level specs (stays at root)
└── CLAUDE.md                # new root-level monorepo guide
```

Move rules:

- `git mv` every existing top-level Python entry into `stock-pipeline-v2/` EXCEPT
  the new `docs/superpowers/` specs tree (stays at root) and `.git`.
- `pyproject.toml` `testpaths`/packaging stays valid because everything moves
  together; the `stock_pipeline_v2` package path is unchanged relative to its own
  `pyproject.toml`.
- **Guardrail:** `cd stock-pipeline-v2 && uv run pytest -m "not slow"` must pass
  after the move with the same result as before. Run it before and after.
- Existing root `CLAUDE.md` moves into `stock-pipeline-v2/`. A new short root
  `CLAUDE.md` describes the monorepo and points at each subproject.
- Path mentions inside the Python `docs/`/`README` are already historical
  (`vm-workspace`); do not chase them.

## Architecture

Two halves, one data contract. The pipeline produces a per-creator dataset file;
the dashboard reads those files. All creator-specific data is namespaced by handle.

### Pipeline — Bun/TS scripts under `influencer-tracker/pipeline/`

Driven by a creator handle (`bun run pipeline --handle kevvonz`). All stages
idempotent and cached by reel shortcode, so re-runs are no-ops and a failed run
resumes cheaply. No fabricated data: a stage that cannot get real data for an item
skips it and logs, never synthesizes.

Per-creator data root: `data/creators/<handle>/`.

1. **scrape** (`scrape.ts`) — Playwright + stealth, browser-driven
   - Drive a real Chromium session via **Playwright with stealth** (`playwright`
     - `playwright-extra` + `puppeteer-extra-plugin-stealth`, or `rebrowser-playwright`)
       to look like a human browser and minimize ban risk. Reuse the user's logged-in
       Instagram session via cookies / a persistent user-data dir.
   - Navigate to `instagram.com/<handle>/`, scroll the reels grid with human-like
     randomized delays until 12 months of posts are loaded, harvesting shortcodes +
     **post dates** from the page's embedded GraphQL/JSON responses (intercept
     network) rather than brittle DOM scraping.
   - Download each reel's video + caption (via the captured media URL, or `yt-dlp`
     per shortcode as the actual-file fetcher). Throttle aggressively.
   - Output: `data/creators/<handle>/raw/<shortcode>/` (video + `meta.json`).

2. **transcribe** (`transcribe.ts`)
   - `ffmpeg` extracts audio → Groq `whisper-large-v3` (verbose_json, segments).
   - Output: `data/creators/<handle>/transcripts/<shortcode>.json`. Skips if present.

3. **frames** (`frames.ts`) — vision enrichment
   - `ffmpeg` samples ~2–3 representative frames (keyframes / mid-points).
   - Groq vision model reads **on-screen ticker symbol and any displayed price**.
   - Fixes garbled speech (Whisper transcribed "NBIS" as "nebious"; the broker
     overlay showed `NBIS`). Output merged into `.../frames/<shortcode>.json`.

4. **extract** (`extract.ts`)
   - Groq `llama-3.3-70b` over transcript + caption + frame hints.
   - Emits structured per reel: `{ ticker, company, direction, is_explicit_buy,
conviction (0-1), quote, on_screen_price? }`.
   - **Filter: keep only `is_explicit_buy === true` bullish calls** for scoring;
     retain the rest tagged for the timeline.
   - Writes `.../calls.review.md` (human-readable) so the user sanity-checks
     classifications before scoring. Pipeline pauses here for review on first run.

5. **prices** (`prices.ts`)
   - `yahoo-finance2` npm → daily OHLC for each called ticker + `SPY`, from the
     earliest call date minus a buffer through today.
   - Output: `.../prices/<ticker>.json`. Fail-closed: a ticker with no price data
     is flagged, not dropped silently. SPY is fetched once and shared across creators.

6. **score** (`score.ts`)
   - For each call compute forward return at 1w / 1m / 3m / since-call, and the
     same windows for SPY → **excess return**.
   - Dedupe to **first bullish mention per ticker (per creator)** for the scorecard;
     keep all reels on the timeline.
   - Emit `data/creators/<handle>/dataset.json` and update `data/creators/index.json`
     (list of creators + headline scorecard each, for the dashboard landing page).

### Data contract — `dataset.json` (per creator, sketch)

```jsonc
{
  "creator": { "handle": "kevvonz", "name": "Kevin Hu" },
  "generatedAt": "2026-06-02",
  "spyAnchor": "SPY",
  "calls": [
    {
      "shortcode": "DZDmQutB0Ep",
      "postDate": "2026-06-01",
      "ticker": "NBIS",
      "company": "Nebius Group N.V.",
      "isFirstCall": true,
      "conviction": 0.9,
      "quote": "told you guys to buy right here",
      "onScreenPrice": 273.01,
      "returns": {
        "1w":  { "stock": 0.0, "spy": 0.0, "excess": 0.0 },
        "1m":  { "stock": null, "spy": null, "excess": null },
        "3m":  { "stock": null, "spy": null, "excess": null },
        "toDate": { "stock": 0.0, "spy": 0.0, "excess": 0.0 }
      }
    }
  ],
  "tickers": {
    "NBIS": { "ohlc": [ { "date": "...", "o": 0, "h": 0, "l": 0, "c": 0 } ] },
    "SPY":  { "ohlc": [ ... ] }
  },
  "scorecard": {
    "totalCalls": 0, "uniqueTickers": 0,
    "hitRate": { "1m": 0.0, "3m": 0.0 },
    "avgExcess": { "1w": 0.0, "1m": 0.0, "3m": 0.0, "toDate": 0.0 },
    "callsPerWeek": 0.0,
    "best": [], "worst": []
  },
  "caveats": ["survivorship", "reposts-deduped", "forward-from-post-date"]
}
```

`index.json`: `[{ "handle": "kevvonz", "name": "Kevin Hu", "totalCalls": 0,
"avgExcess3m": 0.0, "generatedAt": "..." }]`.

### Dashboard — TanStack Start app under `influencer-tracker/`

Stack: TanStack Start (file routing + server fns), Vite, Bun, Tailwind v4,
shadcn/ui, and **bklit-ui** charts (shadcn registry: candlestick, line, composed).

Routes / views:

- **`/` Landing**: list of tracked creators from `index.json`, each a card with
  headline scorecard (total calls, avg 3m excess). One creator today; grows as more
  are added. (Cross-creator comparison view deferred — see Deferred.)
- **`/c/$handle` Overview**: scorecard cards (hit rate, avg excess by horizon,
  calls/week, best/worst), plus a 12-month **timeline** — one marker per call,
  colored by since-call excess return (green beats SPY, red lags). Click → ticker.
- **`/c/$handle/ticker/$symbol`**: bklit candlestick/line chart of the ticker with
  call markers overlaid on the dates the creator called it; forward-return table vs
  SPY; the reel quotes.
- **Persistent honesty banner** describing the caveats below.

Data loads from the per-creator `dataset.json` + `index.json` via a server function
/ static import. No backend beyond serving the files.

## Accuracy methodology & caveats

The dashboard must not overclaim. Three caveats are first-class, shown in-product:

1. **Survivorship bias.** Deleted losing-call reels are unscrapeable, so measured
   accuracy is an upper bound. Labelled loudly; cannot be fully corrected.
2. **Re-posts.** Creators re-promote winners repeatedly. Scorecard dedupes to the
   first bullish mention per ticker; the timeline still shows every reel.
3. **Forward-from-post-date.** We ignore the gains a creator brags about from old
   entries and measure only what happened _after_ each reel's post date — the honest
   test of signal quality for a viewer who acted on the reel.

Excess-vs-SPY is the headline metric specifically so a rising-tide bull market does
not make a creator look skilled.

## Tech stack & external dependencies

- Runtime: **Bun**. Language: TypeScript.
- Scrape: **Playwright + stealth** (`playwright-extra` + stealth plugin or
  `rebrowser-playwright`), browser-driven with the user's logged-in session.
  `yt-dlp` as a per-shortcode video downloader.
- Media: **ffmpeg** (already installed).
- STT + vision + extraction: **Groq API** (`whisper-large-v3`, a Groq vision
  model, `llama-3.3-70b`), read from `GROQ_API_KEY` env, never hardcoded. User has
  accepted reusing the supplied key.
- Prices: **yahoo-finance2** (npm).
- UI: TanStack Start, Vite, Tailwind v4, shadcn/ui, bklit-ui registry.

## Success criteria

1. `bun run pipeline --handle kevvonz` (orchestrating the 6 stages) produces a valid
   `dataset.json` covering the last 12 months of reels, after a one-time human
   review of `calls.review.md`, and updates `index.json`.
2. Every scored call has a real post date, real OHLC, and a computed excess return
   (or an explicit null where the horizon hasn't elapsed yet).
3. `bun dev` serves the dashboard: landing lists the creator, overview timeline +
   scorecard render, and each ticker page shows a price chart with correctly-dated
   call markers.
4. Caveats are visible in-product.
5. Adding a second creator requires no code change — only `bun run pipeline --handle <new>`.
6. `cd stock-pipeline-v2 && uv run pytest -m "not slow"` passes unchanged after the
   Phase 0 move.

## Risks

- **IG scraping fragility / ToS.** Even browser-driven, Instagram can rate-limit
  or challenge the logged-in account; the account carries a small lock/ban risk.
  Mitigation: Playwright stealth, human-like randomized scroll/delays, aggressive
  caching, a throwaway account if available. If a full year can't be pulled, fall
  back to user-supplied reel URLs.
- **Ticker extraction errors.** LLM may misclassify. Mitigation: vision cross-check
  - mandatory human review of `calls.review.md` before scoring.
- **Sparse / delisted tickers.** Some picks may lack clean Yahoo data. Mitigation:
  flag and exclude with a visible note, never fabricate.
- **Groq rate limits** across whisper/vision/llm for dozens of reels. Mitigation:
  cache per shortcode, sequential with backoff.

```

```
