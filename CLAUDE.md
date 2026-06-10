# CLAUDE.md — influencer-tracker

Scores finfluencer stock calls against forward prices vs SPY. Each creator is a
self-contained dataset under `data/creators/<handle>/`; the dashboard (TanStack
Start) reads `dataset.json`. Two ingestion pipelines feed the **same** downstream
contract, so scoring and the UI are platform-agnostic.

## Development workflow (worktrees only)

All feature work happens in a git **worktree on its own branch** — never on `main`.

- **Never edit features on `main`** and **never switch this checkout off `main`**
  (`git checkout <other>` / `git switch` in the primary clone is off-limits). The
  primary checkout stays on `main` so parallel work never collides.
- Start each feature in its own worktree: `git worktree add ../influencer-tracker-<feature> -b <feature>`.
  One worktree per feature, one branch per worktree.
- When done and verified, merge the branch back to `main` locally (fast-forward or
  `git merge`), then `git worktree remove`. Open a PR only if explicitly asked.

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
opens `ProofViewer` (`src/components/proof-viewer.tsx`) — a Base UI dialog on
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

**Prices are insert-only, both stores.** `mergePrices` (`src/lib/prices-merge.ts`) is
**existing-wins** on a date collision — an existing bar keeps its OHLC; only
genuinely-new dates are appended. This mirrors the DB `prices` table (insert-only via
`onConflictDoNothing` in `db/backfill.ts` `backfillPrices`). Both are insert-only **by
design** so forward-return scoring stays reproducible: a later Yahoo restatement
(split/dividend) can never silently rewrite a bar an accuracy figure was computed
against. `backfillPrices` `console.warn`s when an incoming bar differs from a frozen
stored bar (so a restatement is visible, not silently dropped).

**Restatement runbook (intentional split/dividend).** Rewriting a frozen price is an
**OWNER-role** operation — neither the `ingest` role (insert-only on `prices`) nor the
`serve` role (read-only) can do it. Connect as the DB owner, `UPDATE prices SET … WHERE
symbol = … AND date = …`, then **re-run the affected creator(s)' `score`** (so the
static store + baked accuracy recompute) and **`bun run scripts/parity-check.ts`** (must
print `PARITY OK`). The merge fn and the DB stay insert-only; the owner UPDATE is the
single sanctioned path to change a scored bar.

`QueryClient` is wired in `src/router.tsx` via `setupRouterSsrQueryIntegration`;
the root route is `createRootRouteWithContext<{ queryClient }>`. The ticker
loader prefetches the default timeframe with `ensureQueryData` for an SSR first
paint.

## Data source: DB vs static (Plan 1 — live re-architecture)

Migrating from static-JSON-baked-at-build to **Neon Postgres as source of truth**, so
data updates need no redeploy (see `docs/superpowers/specs/2026-06-10-live-ingestion-rearchitecture-design.md`
and `docs/superpowers/plans/2026-06-10-live-rearch-plan1-db-foundation.md`). Plan 1 (the
foundation) is in; Plans 2–4 (cross-creator features, ingest+materialize+cache, LLM gate)
follow.

- **Schema** (`db/schema.ts`, drizzle + `@neondatabase/serverless` neon-http): `creators`,
  `calls` (PK `(handle, shortcode)`, `ord` column preserves source file order — `postDate`
  has ties), `prices` (shared per-symbol OHLC), `artifacts` (materialized serve payloads,
  Plan 2). Migrations: `bun run db:generate` / `db:migrate`. Client is lazy — never
  constructed at module load, so it stays out of the client bundle. Two read/write seams
  (`db/client.ts`): `getDb()` = public SSR read path, connects as the SELECT-only **serve**
  role (`DATABASE_URL_SERVE`, falls back to owner); `getWriteDb()` = operator scripts
  (backfill/materialize), connects as the **ingest** role (`DATABASE_URL_INGEST`).
- **`USE_DB` flag** (`src/lib/data.ts`): `"1"` = `listCreators`/`fetchDataset`/`fetchPrices`
  read from the DB **during SSR only** (window-guarded, DB modules dynamically imported);
  unset/`"0"` = the current static-JSON path. **Static JSON is always the panic fallback** —
  any DB error logs and degrades to it. Flip back instantly with `USE_DB=0`.
- **Least-privilege DB roles** (`scripts/apply-roles.ts`, run via `db:roles`): **ingest**
  (writer) has INSERT/UPDATE on creators/calls/artifacts and INSERT-only on `prices`
  (UPDATE/DELETE REVOKEd — frozen scoring, never rewrite a scored price); **serve** (public
  read path) is SELECT-only on every table. Passwords: `INGEST_ROLE_PASSWORD`,
  `SERVE_ROLE_PASSWORD` (both >=16 chars `[A-Za-z0-9_-]`). Both roles use explicit grants
  only (no ALTER DEFAULT PRIVILEGES) — re-run `db:roles` after any migration that adds a table
  (both roles; Plan 4 adds tables the serve role must not see, so auto-grant is unsafe).
- **Sync** (`bun run db:sync` = `db:backfill && db:materialize`, runs as ingest) loads the
  committed static data into the DB, idempotently (creators/calls upsert all columns; prices
  insert-only), then re-materializes the calls-index artifact. Always sync, never bare
  `db:backfill` — a backfill without a re-materialize leaves a stale artifact (review M2).
  **Parity gate**: `bun run scripts/parity-check.ts` asserts DB reassembly == static JSON
  (canonical deep-equal) for index, every dataset, **every price symbol**, **and the
  materialized calls-index artifact** — must print `PARITY OK` before flipping `USE_DB=1`.
- **Tests**: `db/*.test.ts` + `src/lib/db-read.test.ts` are env-gated (`DATABASE_URL_TEST`,
  `DATABASE_URL_INGEST_TEST`, `DATABASE_URL_SERVE_TEST` — a separate Neon **branch**, since
  they `TRUNCATE`). `db/test-db.ts` `assertSeparateTestDb()` refuses to TRUNCATE if the test
  URL equals `DATABASE_URL` (prod). `prices-immutable`/`serve-readonly` prove the role grants.
  All skip when unset, so `bun test` stays green without a DB.
- **Cutover** (when ready): `bun run db:migrate && bun run db:roles` on prod (creates both
  ingest + serve roles) → `bun run db:sync` (= `db:backfill && db:materialize` — never bare
  backfill, or the artifact goes stale) → `parity-check` prints OK → set
  `DATABASE_URL_SERVE` + `USE_DB=1` in Vercel prod env → one last redeploy.
  Plan 3a edge-caches the serve routes (`/c/**`, `/t/**`, `/explore`, `/api/*`) via Vercel ISR
  at a 6h TTL (`vite.config.ts` `routeRules`), so SSR creator-page renders are served from the
  CDN, not a fresh ~1.4 MB Neon pull each time — only the post-TTL revalidation hits the DB.
  Client-side navigation reads the same CDN-cached `/api/*` routes (DB-backed), so a prod DB
  change surfaces within the 6h ISR TTL with no redeploy (or immediately once the Plan 3b purge
  seam busts the CDN). Revert via `USE_DB=0` if SSR latency regresses.
- **Revalidate seam** (`src/routes/api/revalidate.ts`, POST, token-guarded by `REVALIDATE_TOKEN`):
  the place Plan 3b's VM ingest will POST changed `{ paths, tags }` to bust the ISR-cached CDN
  entries. In 3a it's operator-callable + auth-tested only (`Authorization: Bearer`; unset token
  → 503, mismatch → 401); the actual Vercel-API CDN purge is a 3b `TODO` (needs the project token,
  which lives with the VM), so `purge` currently just records intent and does not bust the CDN.

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
primitives are pulled from **coss-ui** (`@coss` registry, `https://coss.com/ui/r/{name}.json`)
— Cal.com's shadcn-style component set built on **Base UI** (`@base-ui/react`).
`components.json` registers `@coss` and uses the `base-nova` style, so
`bunx --bun shadcn@latest add @coss/<name>` pulls the canonical coss component.
Re-sync a primitive by re-running that add with `--overwrite`.

Two `ui/*` files are deliberately **not** coss and must stay custom:
- `scroll-area.tsx` / `table.tsx` — lina edge-fade mask (coss's scroll-area has no
  mask; `table` wraps lina for the horizontal fade). Keep on re-sync.
- `drawer.tsx` — vaul (drag-to-dismiss + background scale). coss/Base UI's Drawer
  supports the same via `Drawer.SwipeArea` + the Indent parts
  (`Drawer.Provider`/`IndentBackground`/`Indent`); a swap is feasible but unbaked.

| Local file(s) | Source |
|---|---|
| `src/components/WorkspaceRail.tsx` (and `MobileNav.tsx`, which reuses its `RailContent`) | devl.dev — https://www.devl.dev/c/layouts/workspace-rail (aesthetic reference) |
| `src/routes/c.$handle.index.tsx` (`Overview`: `StatTile` strip + `CallsList`) | devl.dev — https://www.devl.dev/c/dashboards/metrics-overview (took the stat-tile strip + recent-activity list; bklit charts dropped into the chart slots) |
| `src/components/charts/*` + `AnalyticsCharts.tsx` | bklit-ui — github.com/bklit/bklit-ui (copy-in) |
| `src/components/ui/*` (accordion/badge/button/card/pagination/separator/spinner/switch/toggle/toggle-group) | coss-ui (`@coss` registry) — Base UI primitives. Re-sync: `bunx --bun shadcn@latest add @coss/<name> --overwrite` |
| `src/components/ui/drawer.tsx` | vaul (kept; not coss) — mobile drag-to-dismiss + background scale |
| `src/components/ui/scroll-area.tsx`, `src/components/ui/table.tsx` | lina — github.com/SameerJS6/lina (Base UI `ScrollArea` + edge-fade mask; `table` wraps it). Custom, not coss |
| `proof-viewer`, `CaveatsBanner`, `ChartBoundary` | app-specific, hand-built |

To grab a fresh devl.dev snippet: open the component page and press `c` for code
(client-rendered — not in the page HTML).

## Scroll areas (lina)

Any scrollable region (overflow lists, wide tables, drawer bodies) uses the lina
`ScrollArea` (`src/components/ui/scroll-area.tsx`), **not** raw `overflow-*`. lina
adds an adaptive edge-fade mask that appears only when content is scrollable and
native-feeling touch scrolling. Wired into: the ticker calls table (`ui/table.tsx`,
horizontal), the proof-viewer drawer body, and the `WorkspaceRail` nav.

**The mask must always match the surface background**, or the fade reveals the
wrong color at the edges. The mask color is the CSS var `--scroll-mask-color`,
defaulting to `var(--color-background)` (correct for any `bg-background` surface).
On a non-default surface, pass `maskColor` (e.g. `maskColor="var(--card)"`) so the
fade blends into that surface. Tables auto-size: lina's viewport is `size-full`
(needs a definite-height parent), so `ui/table.tsx` passes `viewportClassName="h-auto"`
to size to the table; a drawer body needs the drawer at a definite `h-[…]` (not
`max-h-`) for `flex-1` to bound the scroll area.

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
  on `@visx` + `d3`, rendered as SVG. Only the used subset is kept (unused
  area/bar/scatter/composed types were pruned). Time-series charts
  (candlestick/line) need `x` as a `Date`; gauge/funnel are categorical. Wrap
  charts in `ChartBoundary`. The ticker page's charts are `React.lazy`-split into
  `charts/ticker-charts.tsx` so `motion`/`@visx`/`d3` load on mount, off the
  route's initial bundle.

## Analytics (PostHog)

Client-side PostHog, ingested through a reverse proxy. `src/lib/analytics.tsx`
exports `<Analytics />`, a render-nothing component mounted once in `RootComponent`
(`__root.tsx`). On mount it dynamic-imports `posthog-js` (keeping the ~68KB SDK off
the initial route bundle) and inits; it skips init entirely when `VITE_POSTHOG_KEY`
is unset, so local dev and SSR stay clean. Config pins the posthog-js
`defaults: '2026-01-30'` snapshot — that's what enables `capture_pageview:
'history_change'` (pageviews fire on every TanStack Router navigation, since the
router uses the History API), pageleave, and head-injected external scripts
(SSR-safe replay recorder) — plus explicit `autocapture` (every click, the source
for "which sections are buried / least clicked") + session replay
(`session_recording`, passwords masked). Session replay must **also** be toggled on
in the PostHog project settings, not just here. The project token is public (ships to the client) — it's a
build-time `VITE_` var, set in Vercel like `VITE_SITE_URL`.

**Reverse proxy.** `api_host` is `/relay` (not a PostHog host). `nitro.routeRules`
in `vite.config.ts` rewrite `/relay/static/**` → `us-assets.i.posthog.com/static`
(SDK/recorder assets) and `/relay/**` → `us.i.posthog.com` (ingestion). Plain proxy
rules compile to **CDN-level rewrites** on Vercel (edge, no function invocation), so
events ride our own origin and ad/tracker blockers (which blocklist `*.i.posthog.com`)
can't drop them. `ui_host` stays `https://us.posthog.com` so in-app links work. There
is no `VITE_POSTHOG_HOST` — the US upstreams are baked into the route rules (swap them
for EU). The `/static` rule must stay first (more specific match).

`VITE_POSTHOG_KEY` is set in Vercel at **production scope only** — preview deploys
(and local dev without a `.env` key) intentionally send nothing, so preview/PR traffic
never pollutes the production analytics. Add the key to the preview scope only if you
explicitly want a preview tracked. PostHog project is `influencer-tracker` (ID 463765,
US) in the personal org; dashboard at https://us.posthog.com/project/463765.

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
