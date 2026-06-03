# CLAUDE.md — influencer-tracker

Scores finfluencer stock calls against forward prices vs SPY. Each creator is a
self-contained dataset under `data/creators/<handle>/`; the dashboard (TanStack
Start) reads `dataset.json`. Two ingestion pipelines feed the **same** downstream
contract, so scoring and the UI are platform-agnostic.

## Pipelines

Both end identically: `reel-calls.json` (a `ReelCall[]`) → `prices` → `score` →
`dataset.json`. Each pauses after `extract` for human review of `calls.review.md`
before pricing. Resume with `--from <stage>`.

- **Instagram** — `bun run pipeline --handle <h> --name "<Name>"`
  Stages: `scrape → transcribe → frames → extract → prices → score`.
- **X/Twitter** — `bun run pipeline:x --handle <h> --name "<Name>"`
  Stages: `scrape → extract → prices → score`.

## How we scrape

**Instagram** (`pipeline/scrape.ts`, video-first):
- Playwright + stealth, persistent `.chrome-profile` (headful). On a fresh
  profile it **waits for manual IG login** (polls for the `ds_user_id` cookie)
  before scrolling — don't automate the login.
- Harvests shortcodes + dates from intercepted GraphQL while scrolling the
  `/reels/` page back to the cutoff (default 12 months).
- Downloads each reel with `yt-dlp`, reusing the session via an exported
  Netscape cookie jar (`data/creators/<h>/cookies.txt`, gitignored).
- Then: `transcribe` (Groq Whisper), `frames` (sample 3 frames → Groq vision
  for on-screen ticker/price hints), `extract`.

**X/Twitter** (`pipeline/x/scrape-x.ts`, text-first):
- Rettiwt-API, authenticated by `RETTIWT_API_KEY` — a base64 cookie key from a
  **throwaway** X account (never a real one). See `.env.example` for how to
  build it from the `auth_token`/`ct0`/`kdt`/`twid` cookies.
- `tweet.search` with `onlyOriginal` (no retweets/replies) over `[cutoff, now]`.
  A single search caps at ~3,200 tweets, so we **walk backwards in date windows**
  (`endDate = oldest seen`, dedupe by id) to cover the full range.
- Transient `404/429/5xx` are retried with backoff (`isTransient`) — X
  load-sheds with 404s mid-pagination; don't treat them as fatal.
- Downloads attached images (https only) to `raw/<tweetId>/img_*.jpg` for the
  vision step in `extract-x`.

## What to extract per call

The shared classifier (`pipeline/calls.ts`, `CLASSIFY_SYS`) returns, per post:
`ticker`, `company`, `direction` (bullish/bearish/neutral), `isExplicitBuy`,
`conviction` (0–1), `quote` (the verbatim call), `onScreenPrice`, and `summary`
(one neutral sentence, <160 chars, on what the post is about + the thesis).
`shortcode` = IG reel code or X tweet id; `postDate` = post date.

**Only explicit bullish calls** (`isExplicitBuy && direction === "bullish"`) are
scored. Accuracy = forward return vs SPY (excess) at 1w/1m/3m/to-date.

**LLM providers.** `classify(model, body, client)` takes the OpenAI-compatible POST
fn as `client`. IG extract uses Groq (`pipeline/groq.ts`, default). The X path
processes thousands of posts, so `extract-x` routes everything to **Fireworks**
(`pipeline/fireworks.ts`), which isn't throttled like Groq's free tier:
text classification → `FIREWORKS_MODEL` (`deepseek-v4-flash`), image-vision hints →
`FIREWORKS_VISION_MODEL` (`kimi-k2p5`). Both were picked by a bake-off on real
TheProfInvestor data — deepseek-v4-flash beat gpt-oss-120b on call-detection
(it under-flagged implicit "going higher"-style calls); kimi-k2p5 matched
qwen3p6-plus's OCR accuracy at ~8x the speed (qwen's latency was timing out the
extract). Note the cheap small VLMs (qwen3-vl-8b, gemma-4, llama-vision) are
**on-demand-GPU only** on Fireworks — they 404 on serverless. All paths reuse the
same `CLASSIFY_SYS` + parse.

## Proof embeds

Each call links to its source via `shortcode`: numeric ⇒ X tweet embed, otherwise
⇒ IG reel embed (`/reel/<code>/embed`). On the ticker page, tapping a call row
opens `ProofViewer` (`src/components/proof-viewer.tsx`) — a Radix dialog on
desktop and a vaul drawer on mobile (switched via `useMediaQuery`, 768px) — that
shows the embed + summary + quote. No local media is needed for display.

## Chart data: baked for scoring, live for display

Two price paths, deliberately split:

- **Scoring** reads per-creator OHLC at pipeline `score` time
  (`pipeline/prices.ts`, Yahoo daily, cached under `data/creators/<h>/prices/`).
  Frozen so forward-return accuracy is reproducible — never recompute it live.
- **Ticker charts** fetch OHLC live from Yahoo per timeframe via a server
  function (`src/lib/chart-fetch.ts` → `fetchChart`), keyed through TanStack
  Query (`src/lib/chart-query.ts`, `chartQuery`). `src/lib/chart-window.ts`
  maps the timeframe to a Yahoo interval the retail-app way: intraday for
  1D/1W/1M (within Yahoo's ~60-day sub-daily cap), daily for 3M+. The server
  fn caches per `symbol:timeframe` (~5 min) and runs server-side so
  `yahoo-finance2` and the no-key fetch stay out of the client bundle. On a
  Yahoo error the ticker route falls back to baked daily OHLC fetched lazily
  via `fetchPrices(symbol)` (`src/lib/data.ts`) for the symbol + SPY only.

### Dataset is slim — OHLC does not ship with it

`dataset.json` does **not** contain a `tickers`/OHLC map (it used to — that
dehydrated ~5 MB of baked prices into the SSR HTML and pushed pages past crawler
caps). The split, by granularity:

- **Display** — `dataset.json` carries `calls` + `scorecard` + `creator` +
  `caveats`. Each `Call` has a baked `spark: number[]` (downsampled closes from
  `postDate` forward, `src/lib/spark.ts`) so the creator-page sparklines
  (`Sparkline` takes `closes: number[]`) need no OHLC.
- **Prices** — baked daily OHLC lives in a shared, deduped per-ticker store
  `data/prices/<symbol>.json` (one file per symbol across **all** creators;
  `score.ts` merges via `src/lib/prices-merge.ts` so a shorter history never
  truncates another's). `prebuild.ts` copies it to `public/prices/`; only the
  ticker-page fallback fetches it, lazily.

`data/prices/` is committed (it's the build-time source for `public/prices/`).

`QueryClient` is wired in `src/router.tsx` via `setupRouterSsrQueryIntegration`;
the root route is `createRootRouteWithContext<{ queryClient }>`. The ticker
loader prefetches the default timeframe with `ensureQueryData` for an SSR first
paint.

## Profile pics

Platform-agnostic, like the `ReelCall` contract. Each scraper resolves its own
avatar URL and calls `saveAvatar(handle, url)` (`pipeline/avatar.ts`), which
downloads the bytes and writes a base64 data URI to `data/creators/<h>/avatar.txt`
(inlined because CDN avatar URLs are signed and expire). `score.ts` reads that
into the `index.json` entry's `avatar` field; `WorkspaceRail` renders it, falling
back to an icon. IG resolves via `web_profile_info`, X via Rettiwt
`user.details().profileImage`. A new platform (e.g. TikTok) only needs to resolve
its URL and call `saveAvatar` — downstream is already universal.

## Component provenance

Where the UI came from, so it can be re-synced from canonical sources. The `ui/*`
primitives are shadcn/ui-style (radix-ui + vaul + cva) — **not** coss-ui (Base UI);
devl.dev designs are built on coss-ui, but here only the *design* was borrowed and
reimplemented on local primitives.

| Local file(s) | Source |
|---|---|
| `src/components/WorkspaceRail.tsx` (and `MobileNav.tsx`, which reuses its `RailContent`) | devl.dev — https://www.devl.dev/c/layouts/workspace-rail (aesthetic reference) |
| `src/routes/c.$handle.index.tsx` (`Overview`: `StatTile` strip + `CallsList`) | devl.dev — https://www.devl.dev/c/dashboards/metrics-overview (took the stat-tile strip + recent-activity list; bklit charts dropped into the chart slots) |
| `src/components/ThemeToggle.tsx` | transitions.dev icon-swap pattern (3-state) |
| `src/components/charts/*` + `AnalyticsCharts.tsx` | bklit-ui — github.com/bklit/bklit-ui (copy-in) |
| `src/components/ui/*` (badge/card/drawer/separator/table) | shadcn/ui-style primitives (radix-ui + vaul + cva) |
| `proof-viewer`, `CaveatsBanner`, `ChartBoundary` | app-specific, hand-built |

To grab a fresh devl.dev snippet: open the component page and press `c` for code
(client-rendered — not in the page HTML).

## Conventions

- **Tests run on `bun test`** (files import `bun:test`, NOT vitest). Typecheck
  with `bunx tsc --noEmit`. The `#/` alias maps to `src/`.
- The X path reuses `pipeline/prices.ts`/`pipeline/score.ts`/`src/lib/scorecard.ts`/
  the dashboard unchanged — keep new platforms emitting the `ReelCall` shape, don't fork them.
- Secrets in `.env` (gitignored): `GROQ_API_KEY`, `RETTIWT_API_KEY`,
  `FIREWORKS_API_KEY` (X text classification). Groq
  free-tier is rate-limited; `pipeline/groq.ts` backs off on 429 — expect slow
  vision/extract stages, not failures.
- Charts: bklit-ui components (github.com/bklit/bklit-ui), vendored copy-in
  (shadcn-style, so not in `package.json`) under `src/components/charts/`, built
  on `@visx` + `d3`, rendered as SVG. Time-series charts (candlestick/line/area/
  bar) need `x` as a `Date`; gauge/funnel/scatter are categorical. Wrap charts in
  `ChartBoundary`.

## Deployment (Vercel)

Hosting is Vercel (framework preset: TanStack Start). The `nitro/vite` plugin
(`vite.config.ts`) makes the build emit Vercel Build Output (`.vercel/output`);
Nitro auto-detects the platform from the `VERCEL` env at build time.

**Auto-deploy.** The GitHub repo (`MassiveMassimo/influencer-tracker`, standalone)
is connected to the Vercel project (root `.`). Push to `main` → production; PRs →
preview. Production URL: `https://influencer-tracker-beta.vercel.app`.

**Build = precompute then bundle** (`package.json`): `bun run scripts/prebuild.ts && vite build`.
`scripts/prebuild.ts` writes into `public/` (which Vite copies to the static client
output → served from the CDN), so the server function stays thin and request-time
compute is minimal. Everything in `public/og/` + `public/datasets/` +
`public/prices/` is generated — gitignored, regenerated each build.

**Datasets + prices are static CDN assets, not bundled** (#2). `prebuild.ts`
copies each `data/creators/<h>/dataset.json` → `public/datasets/<h>.json` and the
shared `data/prices/` → `public/prices/`. `fetchDataset()` / `fetchPrices()`
(`src/lib/data.ts`) are plain fns (not server fns) that fetch those assets —
relative path on the client (browser-cached, gzipped, reused across navigations),
absolute (`siteUrl`) during SSR. Keeps MBs out of the function. Only `index.json`
stays bundled (tiny, every page) via `import.meta.glob` in `dataset-source.ts`.
`data/creators` is gitignored **except** `index.json` + `*/dataset.json`;
`data/prices` (shared per-ticker OHLC) is committed in full. A one-time
`scripts/migrate-split-prices.ts` restructured the pre-split datasets (drop
`tickers`, bake `spark`, emit `data/prices/`); future `score` runs emit the
slim shape directly.

**OG images are pre-rendered to static PNGs at build** (#1). `prebuild.ts` renders
home + every creator + every called ticker via `src/og/` (satori + `@resvg/resvg-js`)
into `public/og/…png`; crawlers hit the CDN and **satori/resvg never run at request
time** (and aren't in the function bundle — no route imports `src/og/render.tsx`).
- Theme is **frozen to `dark`** (`scripts/prebuild.ts` `THEME`); the runtime
  day/night flip (`ogTheme()`) is dropped since social platforms cache OG
  aggressively. The renderer still supports `light` but it's never baked.
- Fonts are base64-embedded in `src/og/fonts.data.ts` (regenerate with
  `bun run scripts/gen-og-fonts.ts` from the vendored `src/og/fonts/*.woff`).
- Meta `og:image` points at the static path (`/og/<h>.png`, `/og/<h>/<sym>.png`);
  absolute URLs come from `VITE_SITE_URL` (**build-time** env in Vercel). New
  creators/tickers get their card only on the next deploy.

**Updating data = re-run the pipeline, commit the changed JSON, push.** The deploy
re-copies datasets and re-renders all OG cards (datasets are frozen-for-reproducibility,
so co-versioning with code is correct).
