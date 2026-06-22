# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is continuously deployed (no published releases or version tags), so
changes are grouped by **date** rather than by semantic version. Entries are
curated to user- and operator-facing changes — see the git history for the full
commit-level detail.

## 2026-06-22

### Added
- Workspace-rail **Stocks** section: top tickers by most-recent call, each with a
  lazy 1D sparkline (batched server fn, gradient area fill, Catmull-Rom smoothing).
- Sweep-style loading skeletons for the area and candlestick charts (replacing
  plain pulse boxes).
- Creator overview: help cards on the stat tiles, platform link on the creator
  name, shared `CategoryBars`, and conviction bucketed by average excess return.

### Changed
- **Serve path reverted to static assets** (`USE_DB=0`). The DB-as-source-of-truth
  serve path was tripping Neon's free-tier egress cap; the committed
  `data/` JSON/prices are the serve source again. The DB is retained **only** for
  the correction loop (reports + overrides). The VM daily run now commits and
  pushes refreshed `data/` instead of backfilling the DB.
- Creator overview leads with a bklit `AreaChart` cumulative excess-vs-SPY curve;
  the call funnel was dropped.
- Ingest hardening: exit non-zero on failure, abort a conflicted rebase.

## 2026-06-19

### Added
- Cumulative **excess-vs-SPY** performance curve in the creator overview featured
  pane (baked into the scorecard, DB/parity-neutral).

## 2026-06-18

### Added
- **Halal compliance badge** (opt-in, off by default): Musaffa-sourced Shariah
  status. Hover badge + preview card on lists; an inline panel (revenue-composition
  donut + AAOIFI financial screens) on stock pages. Live-fetched, fail-open.
- **Ticker-primary page** at `/t/$symbol/$creator` with a creator switcher
  (avatar tabs + morphing search combobox) and a call-timeline swimlane. Legacy
  `/c/.../ticker/...` URLs redirect.

## 2026-06-17

### Added
- Ingest alerts route through the Hermes gateway when `HERMES_BIN` is set (reuses
  Hermes's Telegram creds; no bot token on the VM).
- Ticker headline tracks the chart crosshair, with an animated compact date pill.

### Fixed
- 1D intraday session-window bounds.

## 2026-06-15

### Added
- **Dynamic OG images**: per-creator and per-ticker cards rendered via satori/resvg,
  ISR-cached, with rev-versioned URLs for cache-busting. Ticker cards use a price
  line-graph background.
- **Multiple stock calls per post**: array classifier returning one entry per ticker;
  call identity widened to `(handle, shortcode, ticker)`. Recovered ~63% of tickers
  the prior single-ticker prompt dropped on multi-stock posts.

### Changed
- `isExplicitBuy` widened to span price-target / "going higher" conviction calls,
  not just literal buy phrasing (a bake-off showed literal-only dropped ~49% of real
  buys).
- Profile pics stored as committed image files (`data/avatars/`) returning a CDN
  path, instead of base64 data URIs in `index.json`.

## 2026-06-14

### Added
- **Correction loop** complete: public `/api/report` endpoint (closed-enum reasons,
  salted-IP dedupe, INSERT-only report role), an operator review queue, and a
  "Report incorrect" control in the proof drawer.
- Backend-health indicator derived from data freshness.

### Changed
- **DB cutover to production** (`USE_DB=1`): prod served live from Neon; VM daily
  ingest auto-resumes each handle (manual review gate dropped). *(Later reverted —
  see 2026-06-22.)*

## 2026-06-13

### Added
- **Symbol resolution + scope gate**: canonical `resolveSymbol` seam; scoring drops
  index ETFs / funds / FX / derivatives, keeping only individual securities (equities
  + crypto), keyed off Yahoo `quoteType` (deny-list, fail-open).
- **Durable overrides**: `call_overrides` / `call_reports` tables, `applyOverrides`
  pre-scoring pass, `apply-override` CLI, three-way role split (report / ingest / serve).
- **Self-hosted Parakeet ASR** replaces Groq Whisper for IG transcription (CPU/ONNX,
  ~6× realtime).
- **VM automated ingest**: forward incremental X scrape, no-shrink guard, split
  basis-shift detection, Telegram notifier, `flock`'d resume, systemd timer +
  dead-man, residential `IG_PROXY` egress.

### Changed
- IG vision + classification routed to Fireworks (Groq's free-tier TPM limits stalled
  the pipeline).
- Ticker chart: headline price + Δ%, $ y-axis labels, seamless timeframe transitions,
  intraday axis labels.

## 2026-06-12

### Fixed
- Advisor hardening pass: classification validation, forward-return coverage,
  first-call tiebreak, prices-fetch hardening, X extract dedupe, skip-missing-date,
  API input validation.

## 2026-06-10

### Added
- **Neon Postgres foundation** (Plan 1): drizzle schema + migrations, lazy client,
  backfill/materialize scripts, `USE_DB` cutover flag with static-JSON panic fallback,
  least-privilege ingest/serve roles, artifact parity gate.
- **Cross-creator views**: `/explore` all-calls explorer (client filter/sort/search)
  and `/t/$symbol` per-ticker view, backed by a materialized calls-index artifact.
- **PostHog analytics**, lazy-loaded off the initial bundle and routed through a
  `/relay` reverse proxy.
- Cached read API routes + 6h SWR CDN rules for serve routes; token-guarded revalidate
  seam; data-as-of staleness indicator.

## 2026-06-06

### Added
- **Preferences modal** (reduce-motion, theme picker) + `PreferencesProvider`.
- **Web haptics**: scrub ticks, tab-switch and call-row feedback.
- `llms.txt`, robots Content Signals, and an RFC 8288 Link header for agents.

## 2026-06-04

### Added
- "How to read this" Q&A accordion on the landing page.

## 2026-06-03

### Added
- **SEO + social**: per-page head meta (og/twitter/canonical/icons), `sitemap.xml`,
  on-brand favicon/app icons, and static OG card rendering (home/creator/ticker).
- **Live per-timeframe charts**: TanStack Query wiring, `fetchChart` server fn with
  TTL cache, Yahoo interval mapping, baked fallback; lina zoom/scroll synced across
  price + vs-SPY.
- Per-call **sparklines**, proof viewer (dialog on desktop / drawer on mobile),
  per-call summaries, creator avatars, honest 5-stage funnel, sortable leaderboard
  with sample sizes + low-confidence flags.
- Vercel deploy configuration.

### Changed
- **Slim dataset**: dropped the OHLC `tickers` map from `dataset.json`; baked a
  downsampled `spark` per call and moved OHLC to a shared deduped per-symbol store.
- X classification + extract moved fully to Fireworks (parallel, with resume).

## 2026-06-02

### Added
- Initial scaffold: TanStack Start app + bklit charts.
- **Instagram pipeline**: Playwright stealth scrape + yt-dlp download → Groq Whisper
  transcription → Groq vision ticker/price hints → LLM extraction of explicit bullish
  calls → Yahoo price fetch → score.
- **X/Twitter pipeline**: Rettiwt-API scraper, extractor, and orchestrator emitting
  the same `ReelCall` contract.
- **Scoring core**: forward-return and excess-vs-SPY math, dedupe-first-call,
  scorecard aggregation, validated `dataset.json` + index.
- **Dashboard**: landing creator list, creator overview (scorecard + timeline),
  ticker detail (price chart + returns table), analytics charts (gauge, bar, scatter,
  funnel), and the devl-inspired workspace-rail shell.
