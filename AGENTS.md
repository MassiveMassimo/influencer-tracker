# AGENTS.md

## Project

Influencer Signal Tracker is a Bun, TypeScript, Vite/React application that turns public
Instagram and X posts into reviewed, reproducibly scored investment-call datasets. It also
ships a Vercel dashboard, live ticker charts, and a small Postgres-backed correction loop.

## Working tree policy

- Do feature work in a dedicated git worktree and branch; do not implement features directly
  on the primary `main` checkout or switch that checkout away from `main`.
- Build, typecheck, lint, and test in the feature worktree before merging. Visual checks run
  against the primary checkout after a verified merge because it owns the local dev server.
- Automated browser captures can leave `useInView`-gated values at `0`; confirm reveal
  animations in a real browser. Treat reproducible React console errors as real defects.

## Layout

- `src/routes/` — application and API routes; `src/components/` — shared dashboard UI.
- `src/lib/` — data contracts, scoring, chart queries/fetching, and client utilities.
- `pipeline/` — Instagram/X ingestion, transcription, extraction, prices, and scoring.
- `scripts/` — prebuild, database, materialization, and operator workflows.
- `data/creators/` — durable creator artifacts; raw downloads and frames are disposable,
  gitignored intermediates.

Prefer existing components, Base UI primitives, Lucide icons, and established responsive
patterns. Preserve the structural `ProofCall` contract used by `ProofViewer`.

## Commands

```bash
bun run dev
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:perf                 # Playwright performance suite when relevant
```

Use `bun run fmt:check` to validate formatting; `bun run fmt` writes files. Database commands
are `bun run db:generate`, `bun run db:migrate`, `bun run db:roles`, `bun run db:backfill`,
`bun run db:materialize`, and `bun run db:sync`.

## Data pipeline

```bash
bun run pipeline --handle <handle> --name "<Name>"      # Instagram
bun run pipeline:x --handle <handle> --name "<Name>"    # X/Twitter
```

- Instagram stages are `scrape → transcribe → frames → extract → prices → score`; X stages
  are `scrape → extract → prices → score`.
- Both pause after `extract`. Review `data/creators/<handle>/calls.review.md` before resuming
  with `--from prices`.
- Durable outputs are transcripts, price data, `dataset.json`, and the creator index. `raw/`
  and `frames/` can be deleted and regenerated; do not make runtime code depend on them.
- Only score explicit bullish calls for individual equities or cryptocurrencies. Preserve the
  broader explicit-call semantics: direct recommendations, stated long positions, and bullish
  price-target/conviction calls all qualify; watchlists, no-position mentions, and bearish
  calls do not. Do not silently narrow this classifier.

## External services and secrets

- Never automate an Instagram login. A fresh persistent `.chrome-profile/` must be logged in
  manually; use a warmed burner account, never a personal account. VM Instagram runs require
  residential `IG_PROXY` egress when configured.
- X scraping uses a `RETTIWT_API_KEY` derived from a throwaway account, never a personal one.
- Gemini/OpenAI-compatible keys, database URLs, Vercel tokens, and role passwords are secrets.
  Follow `.env.example`; never expose or commit values. Lower extract concurrency for the
  provider's available RPM before bulk ingestion.

## Data, charts, and corrections

- Pipeline scoring uses frozen per-creator Yahoo OHLC so historical accuracy remains
  reproducible. Ticker charts fetch live Yahoo data server-side and cache by
  `symbol:timeframe`; on failure they fall back to lazily fetched baked daily data.
- Keep `dataset.json` slim: it contains calls, scorecards, creator/caveat metadata, and
  downsampled sparks—not full OHLC maps.
- Public reports accept only the closed reason enum, deduplicate by salted IP hash per
  `(shortcode, ticker)`, and remain operator-only. Do not add free-text public reports or
  expose report reasons.
- Review reports with `bun run scripts/review-reports.ts`; record confirmed corrections with
  `bun run scripts/apply-override.ts`. Overrides are durable and are baked by the next score.
- After deploying correction-loop schema changes, run `bun run db:migrate && bun run db:roles`
  in production and ensure the required report/revalidation environment variables are present.

## Deployment

Vercel serves the app. Static JSON remains the fallback data source; database-serving mode is
SSR-only and uses least-privilege roles. Do not point destructive database tests at production;
the test database must be a separate branch.
