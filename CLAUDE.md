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
- **Visual verification happens on `main`, after merge.** The single local dev
  server runs only against the primary `main` checkout, so changes the user needs
  to eyeball (UI/chart/layout) get merged to `main` first, then verified on that
  dev server — iterate on `main` if the visual pass finds issues. Build/typecheck/
  test verification still happens in the worktree before merging.
- **Browser-automation artifact — `IntersectionObserver` doesn't fire reliably**
  in the claude-in-chrome / headless inspection context. `useInView`-gated reveals
  therefore stay at their initial state in automated screenshots: the creator-page
  `StatTile` NumberFlow values render `0` (gated by `revealed`/`valueInView`, e.g.
  `value={revealed ? seg.value : 0}` in `c.$handle.index.tsx`) even though real
  users see them populate (above-fold IO fires immediately on a real page view).
  Don't mistake the `0` stat tiles for a data bug when verifying via automation —
  confirm reveal-animated UI in a real browser. (Console errors like React #418
  are NOT artifacts — those reproduce regardless of IO.)

## Pipelines

Both end identically: `reel-calls.json` (a `ReelCall[]`) → `prices` → `score` →
`dataset.json`. Each pauses after `extract` for human review of `calls.review.md`
before pricing. Resume with `--from <stage>`.

- **Instagram** — `bun run pipeline --handle <h> --name "<Name>"`
  Stages: `scrape → transcribe → frames → extract → prices → score`.
- **X/Twitter** — `bun run pipeline:x --handle <h> --name "<Name>"`
  Stages: `scrape → extract → prices → score`.

**Raw media is disposable.** Per-creator `raw/` (reel mp4/wav) and `frames/` are pipeline
intermediates — gitignored, never deployed (`.vercelignore`), never read at runtime. The
durable artifacts are `transcripts/`, `dataset.json`, and `prices/`. `run.ts` skips
downloading any reel that already has a transcript, so re-running an existing creator
fetches only new reels and deleting `raw/`+`frames/` is safe (frees ~GBs; only re-fetched
if a reel was never transcribed).

## How we scrape

**Instagram** (`pipeline/scrape.ts`, video-first):
- Playwright + stealth, persistent `.chrome-profile` (headful). On a fresh
  profile it **waits for manual IG login** (polls for the `ds_user_id` cookie)
  before scrolling — don't automate the login.
- Harvests shortcodes + dates from intercepted GraphQL while scrolling the
  `/reels/` page back to the cutoff (default 12 months).
- Downloads each reel with `yt-dlp`, reusing the session via an exported
  Netscape cookie jar (`data/creators/<h>/cookies.txt`, gitignored).
- **Residential egress (`IG_PROXY`).** Both the Playwright harvest and the `yt-dlp`
  download route through `IG_PROXY` when set (`socks5://127.0.0.1:1081` on the VM — the
  iProyal ISP-residential relay, no-auth locally). Unset on the Mac → scrapes direct.
  IG locks accounts scraped from datacenter IPs, so VM runs **must** set it. Also use a
  warmed burner IG account (never a personal one) for `cookies.txt`.
- Then: `transcribe` (self-hosted Parakeet), `frames` (sample 3 frames → Fireworks
  vision for on-screen ticker/price hints), `extract`.

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

The shared classifier (`pipeline/calls.ts`, `CLASSIFY_SYS`) returns a `{"calls":[…]}`
**array — one entry per ticker the post names** (a single post can pitch several stocks,
e.g. "loading up on NVDA and AMD, holding TSLA, avoid INTC"). Each entry has:
`ticker`, `company`, `direction` (bullish/bearish/neutral), `isExplicitBuy`,
`conviction` (0–1), `quote` (the verbatim call for that ticker), `onScreenPrice`, and
`summary` (one neutral sentence, <160 chars, on what the post says about that stock +
the thesis). `toReelCalls` expands the array into one `ReelCall` per ticker (drops
no-ticker entries, collapses duplicate tickers within a post); `score` further collapses
two raw tickers that canonicalize to the same symbol within one post (highest conviction
wins). The prompt deliberately **excludes tickers named only as market context / an index
/ a non-recommended competitor**, so the stored set stays calls-only. An empty array = no
stock call. `shortcode` = IG reel code or X tweet id; `postDate` = post date. **Call
identity is `(handle, shortcode, ticker)`** — the post alone is no longer unique.
(Bake-off 2026-06-15: the prior single-ticker prompt dropped ~63% of tickers on
multi-stock posts; the array prompt on the same `deepseek-v4-flash` recovered 100% recall
with zero false-positive buys. Note: existing creators keep one-ticker-per-post history
until their `extract` stage is re-run with the new prompt — LLM cost, no re-scrape.)

**Only explicit bullish calls** (`isExplicitBuy && direction === "bullish"`) are
scored. Accuracy = forward return vs SPY (excess) at 1w/1m/3m/to-date. **`isExplicitBuy`
deliberately spans the call formats finfluencers actually use** — a literal buy/hold
instruction, a stated long position, AND a bullish price target / "going higher"
conviction call (`"$AMD to 750"`). Do **not** narrow it to literal "buy" phrasing: a
2026-06-15 bake-off measured that wording dropping ~49% of real buys on TheProfInvestor
(price-target posts flipped to `isExplicitBuy:false`), which `guard-no-shrink` correctly
blocked. Bearish/short calls and watchlist/no-position mentions stay `false`.

**Scope gate — only individual securities are scored** (`pipeline/symbol-scope.ts`).
A finfluencer "call" means an individual stock/crypto pick, not "buy the market", so
`score.ts` drops any bullish call whose canonical symbol is an index ETF / mutual
fund / index / FX / derivative, keyed off Yahoo `quoteType`. Kept: `EQUITY`,
`CRYPTOCURRENCY` (the product deliberately scores crypto). Dropped: `ETF`,
`MUTUALFUND`, `INDEX`, `CURRENCY`, `FUTURE`, `OPTION`, **`ECNQUOTE`** (Yahoo's "no
clean primary listing" type — e.g. a foreign ETF like VFV queried without its `.TO`
suffix; a real primary-listed equity never returns it). Deny-list + **fail-open**: a
genuinely-unknown `quoteType` is kept, since silently dropping a real call is worse
than scoring a stray fund. The decision is injected into `assembleDataset` as a pure
predicate (default keeps all, so it stays unit-testable). `quoteTypes()` caches each
lookup to `data/symbol-types.json` (gitignored, regenerable; static per symbol so
scoring stays reproducible without committing it). This removes the index-ETF
over-flag class deterministically — no human review, no false alarms; the residual
extraction errors (false-negatives, ticker confusion between two equities) are an
LLM-quality problem, not a scope one.

**LLM providers — provider matrix.** `classify(model, body, client)` and
`readImage(model, path, client)` take the OpenAI-compatible POST fn as `client`,
so each stage picks its provider. The rule: **self-hosted Parakeet for audio,
Fireworks for everything else. No external LLM API depends on Groq anymore.**

| Stage | Pipeline | Provider | Model |
|---|---|---|---|
| transcribe (audio→text) | IG only | **Parakeet (self-hosted, CPU/ONNX)** | `nemo-parakeet-tdt-0.6b-v2` via `onnx-asr` (`pipeline/transcribe.ts` → `pipeline/asr/transcribe_parakeet.py`) |
| frames / image hints (vision OCR) | IG + X | **Fireworks** | `FIREWORKS_VISION_MODEL` (`kimi-k2p5`) |
| extract (classification) | IG + X | **Fireworks** | `FIREWORKS_MODEL` (`deepseek-v4-flash`) |

Vision + classification (IG *and* X) run on **Fireworks** (`pipeline/fireworks.ts`),
which isn't throttled like Groq's free tier (Groq's TPM limits were stalling IG
vision/extract into multi-minute 429 backoffs). Models picked by a bake-off on
real TheProfInvestor data: deepseek-v4-flash beat gpt-oss-120b on call-detection
(it under-flagged implicit "going higher"-style calls); kimi-k2p5 matched
qwen3p6-plus's OCR accuracy at ~8x the speed. The cheap small VLMs (qwen3-vl-8b,
gemma-4, llama-vision) are **on-demand-GPU only** on Fireworks — they 404 on
serverless. All paths reuse the same `CLASSIFY_SYS` + parse.

**Fireworks billing & cost.** Prepaid-credits, pay-as-you-go drawdown (Fireworks account
"Meeting.ai DEV TOOLS", Tier 3, $5,000/mo hard cap; the `monthlySpendThreshold` is a $100
*alert*, not a cap). **No balance/usage/credits endpoint** — the control-plane API
(`/v1/accounts/...`) exposes only the spend-threshold + resource quotas; check remaining
balance + MTD spend in the Fireworks dashboard. Inference responses carry per-call token
`usage` (sum it for an exact run cost). Live per-1M-token prices (standard tier): **text
`deepseek-v4-flash` $0.14 in / $0.028 cached / $0.28 out**; **vision `kimi-k2p5` $0.60 in /
$0.10 cached / $3.00 out**. Extract is **1 text call/tweet + 1 vision call/image**, so cost
is vision-dominated. **Measured** (onboarding @thelonginvest, 2026-06-14): 8,248 tweets /
2,226 image calls → deepseek 4.4M tok + kimi 6.1M tok → **~$12** off the prepaid balance
(real-time, no billing lag). Budget **~$1.5/1k tweets**, vision is ~⅔ of it (images log
~2.7k tok each — higher-res than naive estimates). Earlier ~$0.50/1k guesses were ~3× low;
trust the balance-ledger delta, not token×list-price math.

**Transcription is self-hosted Parakeet, not Groq Whisper** (replaced it). `onnx-asr`
runs `nemo-parakeet-tdt-0.6b-v2` on CPU (no GPU / no NeMo/CUDA) — benchmarked at
RTF ~0.17 on the 4-core ARM VM (~6x faster than realtime). `transcribe.ts` extracts
a 16 kHz mono wav per reel and shells the batch to `pipeline/asr/transcribe_parakeet.py`
(one model load per run). The Python venv with `onnx-asr` is resolved via
`PARAKEET_PYTHON` (else `~/asr-venv/bin/python`, else `python3`); VM setup is in
`ops/README.md`. **Groq is no longer used** — `pipeline/groq.ts` and `GROQ_API_KEY`
are now dead (only the unused default-client params in `calls.ts`/`vision.ts` still
reference it); safe to drop in a later cleanup.

## Proof embeds

Each call links to its source via `shortcode`: numeric ⇒ X tweet embed, otherwise
⇒ IG reel embed (`/reel/<code>/embed`). On the ticker page **and `/explore`**, tapping
a call row opens `ProofViewer` (`src/components/proof-viewer.tsx`) — a Base UI dialog on
desktop and a vaul drawer on mobile (switched via `useMediaQuery`, 768px) — that
shows the embed + summary + quote. No local media is needed for display. `ProofViewer`'s
`call` prop is a structural `ProofCall` (just the fields it reads), so both a full `Call`
(ticker page) and a slim `CallIndexEntry` (explore) satisfy it; the quote block is
conditional because the index omits `quote` (the embed shows the verbatim post anyway).
On `/explore` the ticker/`@handle` stay links (stopPropagation) while the rest of the row
is the proof trigger; search also matches `shortcode` and `normalizeQuery` turns a pasted
X/IG post URL into its bare id so a remembered link finds its call.

## Correction loop

Public users can flag a misclassified call; operators review and record a durable
override; the next `score()` bakes it in. The loop has two phases:

**Phase 1 — report.** The proof drawer (`src/components/proof-viewer.tsx`) renders a
"Report incorrect" control (`src/components/report-button.tsx`) that POSTs to
`/api/report` (`src/routes/api/report.ts`). The POST body carries `(handle, shortcode,
ticker, reason)` — `ticker` identifies which call within a multi-stock post is flagged.
The endpoint validates the reason against a **closed enum** (`src/lib/report-reasons.ts`:
`wrong-ticker | not-a-buy | wrong-direction | not-a-call | other`) and deduplicates
reporters by salted IP hash (`REPORT_SALT` env, SHA-256) — one vote per IP per
**(call = shortcode+ticker)**, no accounts required. The report record lands in the
`call_reports` table (INSERT-only for the `report` role; FK + dedupe index are 3-col).
Reasons are never free text and never displayed publicly — operator-only — avoiding PII,
stored-XSS, and defamation risk.

**Phase 2 — override.** The operator review queue is `bun run scripts/review-reports.ts`,
which ranks reported calls by distinct-reporter count. After confirming a correction, the
operator records a durable override:

```
bun run scripts/apply-override.ts <handle> <shortcode> --reason "…" [--target NVDA] [--ticker X] [--buy false] [--direction bearish|neutral]
```

`--target` picks **which call in the post** to correct (its classified ticker, matched raw
or canonical); omit it for a single-stock post (legacy whole-post override). `call_overrides`
PK is `(handle, shortcode, target_ticker)`, with `target_ticker = ''` the legacy whole-post
sentinel (existing overrides migrate to it and keep applying). `--ticker` still retags the
matched call to a different symbol.

This writes to the `call_overrides` table (ingest role). The next `score()` run picks it
up: `pipeline/overrides.ts` `applyOverrides` applies all overrides as a deterministic
pass over the raw `ReelCall[]` **before** the `isExplicitBuy && bullish` scope filter —
so the correction is baked identically into `dataset.json` and the DB `calls` row.
Survives re-extract (applied after classification), survives backfill (the override is the
source of truth, not the clobbered row), and survives the VM's ephemeral `git checkout --
data/` (overrides live in the DB, not the working tree). Fail-open: a DB error loading
overrides degrades to scoring the raw classification; it never breaks the pipeline.

**Three-way role split.** `scripts/apply-roles.ts` (run via `db:roles`) manages three
roles on the correction tables:

- `report` — INSERT-only on `call_reports`; blind to `call_overrides` and every other
  table. Used by the public `/api/report` endpoint via `DATABASE_URL_REPORT`.
- `ingest` — reads + writes `call_overrides` (apply-override, score); reads `call_reports`
  (review queue). Cannot write `prices` beyond INSERT (frozen scoring).
- `serve` — SELECT-only on `creators`/`calls`/`artifacts`/`prices`; BLIND to both
  `call_reports` and `call_overrides` (override effect already baked into `calls`).

**Parity-neutral.** Overrides apply at score-time, so their effect lives in `calls` /
`dataset.json` — the same tables `parity-check.ts` already asserts. No change to the
parity gate.

**Propagation.** After `score` + `backfill` + `materialize`, run `scripts/revalidate-creator.ts`
(or the VM's automated daily run does it automatically). With `REVALIDATE_TOKEN` set, the
ISR-cached CDN entries bust within ~1 min; unset, the 6h ISR TTL is the floor (see Plan 3a
cutover docs above).

**Cutover note for the correction loop.** After deploy, re-run `bun run db:migrate &&
bun run db:roles` on prod — this migration adds `call_reports` + `call_overrides` and
`apply-roles.ts` now also creates the `report` role. Required new secrets in Vercel prod
env: `REPORT_ROLE_PASSWORD` (>=16 chars `[A-Za-z0-9_-]`), `DATABASE_URL_REPORT` (connects
as the `report` role), `REPORT_SALT` (any random string, used to salt IP hashes). The
existing `REVALIDATE_TOKEN` must also be set for sub-minute propagation after a correction
is applied.

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
  (`Sparkline` takes `closes: number[]`) need no OHLC. The `scorecard` also carries
  a baked `cumExcess: {t,v}[]` (`src/lib/cum-excess.ts`) — the equal-weight mean
  excess-vs-SPY of scored picks over time (to-date generalized to a daily series,
  endpoint == `avgExcess.toDate`), rendered as the featured curve (`CumulativeExcess`
  → lazy `CumExcessArea`) on the creator overview. Rides the `scorecard` jsonb column,
  so it's DB/parity-neutral; back-filled into existing datasets by
  `scripts/migrate-cum-excess.ts` (clamps prices to `generatedAt`).
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

**Call-deletion runbook (deliberate re-score shrink).** When a re-score legitimately *drops*
calls for a creator (e.g. canonical-symbol consolidation, dropping unpriceable picks), the new
count is below the DB's — and `backfill` refuses to shrink (`n != ds.calls.length` guard; `ingest`
has no DELETE on `calls`). This is an **OWNER-role** op: `DELETE FROM calls WHERE handle = '<h>'`,
then re-run scoped `backfill.ts <h>` + `db:materialize`. First check `call_reports`/`call_overrides`
for that handle — the `call_reports`→`calls` FK cascades on delete. Same shrink also trips the VM's
`guard-no-shrink`, so the daily run BLOCKs on that handle until the DB is reconciled this way.
(2026-06-14: applied to kevvonz, 32→12.)

`QueryClient` is wired in `src/router.tsx` via `setupRouterSsrQueryIntegration`;
the root route is `createRootRouteWithContext<{ queryClient }>`. The ticker
loader prefetches the default timeframe with `ensureQueryData` for an SSR first
paint.

## Data source: DB vs static (Plan 1 — live re-architecture)

Migrating from static-JSON-baked-at-build to **Neon Postgres as source of truth**, so
data updates need no redeploy (see `docs/superpowers/specs/2026-06-10-live-ingestion-rearchitecture-design.md`
and `docs/superpowers/plans/2026-06-10-live-rearch-plan1-db-foundation.md`). **Cutover is
complete (2026-06-14): prod runs live on the DB (`USE_DB=1`) and the VM daily ingest timer is
enabled** — Plans 1–3b shipped (Plan 4's LLM gate stays shelved; see correction-loop section).
A prod DB change now surfaces with no redeploy. `USE_DB=0` remains the instant revert.

> **REVERTED 2026-06-22 — serve path is back on static (`USE_DB=0` in prod).** The DB-as-serve-
> source path burned through Neon's free-tier **5 GB/mo egress** (daily full-DB `materialize`
> reads + the 418-symbol price SELECT fan-out + multi-MB SSR pulls), tripping HTTP 402 and
> suspending Neon compute. Rather than pay, the serve path returned to the committed static
> assets (`data/creators/*/dataset.json`, `data/prices/`, `index.json`) — which the fail-open
> tier already served. **The DB is retained ONLY for the correction loop** (`/api/report` writes
> `call_reports`; `apply-override` writes `call_overrides`; `score` reads overrides via
> `db/overrides.ts`) — all low-traffic, so the free tier holds. The VM daily run no longer
> backfills/materializes/parity-checks; it commits + pushes the refreshed `data/`, and Vercel
> auto-deploys the fresh static. The DB-sync code (`db:backfill`/`db:materialize`/`parity-check`/
> `scripts/revalidate-creator.ts`) is left in place but **off the daily hot path** — usable again
> if a future plan re-enables `USE_DB=1` (e.g. on a paid tier). Everything below describes that
> shelved live-DB serve architecture; treat it as dormant, not current, except the correction loop.

- **Schema** (`db/schema.ts`, drizzle + `@neondatabase/serverless` neon-http): `creators`,
  `calls` (PK `(handle, shortcode, ticker)` — a post can name multiple stocks, so the post
  alone isn't unique; `ord` column preserves source file order — `postDate` has ties),
  `prices` (shared per-symbol OHLC), `artifacts` (materialized serve payloads,
  Plan 2). Migrations: `bun run db:generate` / `db:migrate`. **Migration 0004** (multi-stock)
  widens the `calls` PK, adds `call_overrides.target_ticker` (PK discriminator), and adds
  `call_reports.ticker` (3-col FK to `calls`); it's hand-ordered for a populated prod DB
  (column-add before PK, nullable-add + backfill + NOT-NULL for the report ticker). No new
  tables → **no `db:roles` re-run needed**. Client is lazy — never
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
- **Cutover** (DONE 2026-06-14 — kept as the procedure for a fresh environment): `bun run
  db:migrate && bun run db:roles` on prod (creates both ingest + serve roles) → `bun run db:sync`
  (= `db:backfill && db:materialize` — never bare backfill, or the artifact goes stale) →
  `parity-check` prints OK → set `DATABASE_URL_SERVE` + `USE_DB=1` in Vercel prod env → one last
  redeploy. Note: once the VM has run live, the DB legitimately leads the committed static
  (new ingested calls), so `db:sync`/`parity-check` will fail by design — they're a clean-cutover
  gate only, not re-runnable against an already-live DB.
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

### Plan 3b — VM automated ingest

Daily X-only incremental ingest running on the ARM Ubuntu VM (`ssh ubuntu@imos-vm`, repo at
`~/influencer-tracker`). Refreshes existing creators only — new-creator onboarding stays manual.
Ops units + runbook: `ops/` (`influencer-ingest.{service,timer}`, `notify-fail.service`
dead-man, `ops/README.md` with one-time rsync seed + required `.env` keys).

**Fully automated daily run.** The daily timer fires `scripts/ingest.ts`, which runs `scrapeX` +
`extract-x` for each handle in `INGEST_HANDLES`, then immediately auto-invokes `scripts/resume.ts`
per handle (no human review of `calls.review.md` in between). `resume.ts` sequence (static-serve,
2026-06-22): `guard-no-shrink` → `score`. After all handles, `ingest.ts` commits + pushes the
refreshed `data/` once, and the push triggers Vercel's auto-deploy → fresh static. (The former
DB steps — scoped `backfill.ts` → `db:materialize` → `parity-check` → `revalidate-creator` — were
dropped from the daily path when the serve path returned to static; see the REVERTED banner under
"Data source".)

Every active handle re-scores on every daily run (always-resume), so operator overrides and
to-date/recent-horizon returns mature for all creators without needing a new reviewed call.

`scripts/guard-no-shrink.ts` aborts if the freshly-scored call count is materially below the
committed baseline — truncated-scrape / data-loss prevention — and runs **before** `score`
overwrites `dataset.json`.

**Platform guard (X-only ingest).** `ingest.ts` skips any handle whose stored calls are
majority **non-numeric** shortcodes (`looksInstagram`) — an IG creator wrongly listed in the
X-only `INGEST_HANDLES`. Without it, X-scraping an IG handle hits a same-named X account and
clobbers the real IG data with an empty/foreign scrape (this happened to `kevvonz` 2026-06-18:
twitter.com/kevvonz had 0 tweets → tweet store emptied → funnel divided by 0 → `NaN%/Infinity%`;
fixed by restoring from committed static + removing it from `INGEST_HANDLES`). The skip sends a
BLOCKED alert naming the fix.

**Telegram messages.** On success: a published-summary per handle. On `guard-no-shrink` or parity
failure: a BLOCKED alert containing the manual re-run command for that handle. Delivery goes
through `scripts/notify.ts` `notify()`, which prefers the **Hermes gateway** (`hermes send --to
$HERMES_TARGET`, default home channel) when `HERMES_BIN` is set — reusing Hermes's own Telegram
creds, so no bot token need live in the VM `.env` — and falls back to the raw bot API
(`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`). `ingest.ts` refuses to run blind unless **one** path is
configured (`notifyConfigured()`). On the VM the Hermes path is used (`HERMES_BIN` set, no Telegram
creds). A `notify()` send error is non-fatal — it warns and the ingest still completes.

**Manual `resume.ts` — surviving uses only.** The `flock`-guarded `resume.ts` call over SSH is
retained for two paths: (a) investigating and re-running after a BLOCKED alert; (b) re-scoring
after a human override (flag correction via the report→override loop). No upfront call review
before the automated run — correctness is caught reactively. The accepted tradeoff: silent errors
on low-traffic pages persist in the scorecard until seen and flagged. This supersedes the earlier
"keep the human review gate on the scored subset until precision re-measures >95%" stance — the
report→override correction loop is now the safety net that makes shipping-then-correcting acceptable.

**Forward scrape.** `scrapeX(handle, months, { forward })` (`pipeline/x/scrape-x.ts`) — with
`--forward` fetches only tweets newer than the newest stored (`[newest, now]`, deduped by id),
vs the default backward backfill walk. The image-download tail skips already-downloaded files
(`existsSync`).

**Gotcha — the forward anchor lives in disposable `raw/`.** The "newest stored tweet" anchor is
read from `raw/<handle>/tweets.json` (`loadTweets`), but `raw/` is gitignored and the documented
"raw media is disposable, delete to free GBs" cleanup purges it. With no `tweets.json`, `--forward`
logs `forward requested but no prior data` and silently does a **full 12-month backfill** (re-scrape
+ full re-extract, Fireworks $). For X, `tweets.json` is NOT disposable — it's the incremental
cursor — so don't purge `raw/<handle>/tweets.json` for X creators even though the mp4/img media in
`raw/` is safe to delete. (Hit 2026-06-22: both X handles full-backfilled after a `raw/` purge.)

**Price reactivity + split safety** (`pipeline/prices.ts`, `src/lib/prices-merge.ts`). A
front-covered cached series is now extended forward (fetch a ~10-day overlap from the last
stored bar, insert-only merge) instead of skipped — so to-date returns and recent horizons
mature on each re-run. `detectBasisShift` halts any merge (all three call sites) when it sees
a consistent non-1 close ratio over ≥2 overlapping dates (stock-split restatement signal); the
frozen/insert-only guarantee is preserved — only appends or halts, never rewrites a scored bar.

**Git policy (static-serve, 2026-06-22).** `data/` is the source of truth again, so the daily run
**commits + pushes** the refreshed datasets/index/prices (`ingest.ts`, after all handles) — that
push is what redeploys Vercel and serves the fresh static. Before each run the service still
resets to a clean baseline and pulls latest:

```
git checkout -- data/ && git clean -fd data/ && git pull --ff-only
```

(`git checkout -- data/` reverts tracked files to remote HEAD; `score` then regenerates the
diff that gets committed.) `clean -fd data/` (without `-x`) is safe across all of `data/`:
`.gitignore` shields seeded per-creator state (`raw/`, `frames/`, `transcripts/`, `cookies.txt`)
— `clean` only removes untracked non-ignored files. (Historical note: under the shelved
`USE_DB=1` model this discard existed *because* the DB, not `data/`, was the source of truth and
local static churn was throwaway. Now the churn is the product, so it is committed, not discarded.)

**Revalidate (resolves the 3a TODO).** On-demand ISR revalidation is wired via the Nitro→Vercel
prerender bypass token: `vite.config.ts` sets `nitro.vercel.config.bypassToken =
process.env.REVALIDATE_TOKEN` (baked into each ISR route's `.prerender-config.json` at build),
and `scripts/revalidate-creator.ts` GETs the creator's affected paths (`/c/<h>`,
`/api/dataset/<h>`, `/explore`, `/api/calls-index`, each `/t/<sym>` + `/api/prices/<sym>`)
with header `x-prerender-revalidate: <token>`. Best-effort (never throws); the 6h ISR TTL
(see Plan 3a cutover note above) is the correctness floor if the token is unset or the call
is skipped. The older `/api/revalidate` POST seam remains as a documented, auth-tested target
but is no longer the cache-buster.

## Profile pics

Platform-agnostic, like the `ReelCall` contract. Each scraper resolves its own
avatar URL and calls `saveAvatar(handle, url)` (`pipeline/avatar.ts`), which
downloads the bytes and writes a committed image file `data/avatars/<h>.<ext>`
(extension derived from the content-type; source format preserved, no transcode),
returning the public path `/avatars/<h>.<ext>`. `data/avatars/` is committed as
build-time source (like `data/prices/`); `scripts/prebuild.ts` copies it to
`public/avatars/` (gitignored, served from the CDN, browser/CDN-cacheable).
`score.ts` records the path in `index.json` + the DB `creators.avatar` column;
`<img>` consumers (`WorkspaceRail`, `explore.tsx`, `index.tsx`, `t.$symbol.tsx`)
use the path directly — no logic change needed (an `<img src>` accepts a path or
a legacy data URI identically). The creator OG route
(`src/routes/api/og/c.$handle.$rev.tsx`) resolves the path back to inline bytes
via `resolveAvatar` (satori needs bytes, not paths); it also passes through a
legacy `data:` URI unchanged, so it is robust both before and after the prod DB
migration. IG resolves the avatar URL via `web_profile_info`, X via Rettiwt
`user.details().profileImage`. A new platform (e.g. TikTok) only needs to resolve
its URL and call `saveAvatar` — downstream is already universal.

**Prod cutover.** After merge + deploy, run `bun run db:sync` (= `db:backfill &&
db:materialize`) so `creators.avatar` in the DB becomes the path rather than the
legacy base64 data URI. During the window between deploy and sync the DB still
serves the old URI — `<img>` renders it fine and `resolveAvatar` passes it through
unchanged, so nothing breaks. If `db:backfill` trips the count-guard on a drifted
creator, patch it directly as DB owner:
`UPDATE creators SET avatar = '/avatars/<h>.<ext>' WHERE handle = '<h>';`

## Halal compliance badge

Opt-in (`showHalalStatus` preference, off by default) Shariah-compliance UI. Two
surfaces:

- **Badge + hover popup** (`HalalIndicator`/`HalalBadge` + `HalalCardContent`) on
  **lists** — creator overview, `/explore`, and the `/t` and creator headings:
  `hugeicons:halal` for compliant, lucide circle-question-mark for doubtful;
  not-halal/unknown render nothing. Hover/tap opens a coss `preview-card` with a
  revenue-purity bklit `Gauge` (solid status fill emerald/amber/red, no center label,
  always-visible track) + Musaffa link. Badge/popup live inside row-level `<Link>`s, so
  `HalalIndicator` stops click propagation at the trigger + popup boundary (React events
  bubble through the portal's React tree to the row; without it the router hijacks the
  link and navigates the row).
- **Inline panel** (`HalalPanel`, `src/components/halal/halal-panel.tsx`) on the **stock
  pages** — `/c/$handle/ticker/$symbol` (between the SPY chart and the calls table) and
  `/t/$symbol`. No hover popup here. Shows a bklit **donut** (revenue composition
  halal/doubtful/non-halal, manual center label since bklit's `PieCenter` render-prop
  only fires on hover) + the two AAOIFI financial screens (interest-bearing debt /
  securities, green under the ~30% threshold) + sector + Musaffa link. Self-gates on the
  toggle (renders nothing when off). `unknown` → a muted "Not rated by Musaffa" panel
  with a lookup link — the entry point for non-compliant/uncovered symbols.

**Live, not baked.** Halal status is dynamic (flips on earnings), so it follows the
"live for display" path, not the frozen-scoring path. `fetchHalal` (`src/lib/halal-fetch.ts`,
a `createServerFn`) queries Musaffa's Typesense `stocks_data` collection
(`src/lib/halal/musaffa.ts`, port of the VM's `musaffa_client.py`) with the
server-side `MUSAFFA_API_KEY`; `useHalalStatus` (`src/lib/halal-query.ts`) caches it
client-side (12h staleTime) and is disabled unless the toggle is on. Fail-open: any
error / missing key / unmatched symbol → `unknown` → nothing renders.

**SSR-prefetched for first paint.** Each serve route's loader calls `prefetchHalal`
(`halal-query.ts`) so the data is baked into the dehydrated payload — an opted-in viewer
sees badges on the first client render with no post-hydration round-trip (was ~620ms →
hydration-only). `prefetchHalal` runs **SSR-only** (`typeof window === "undefined"`); on
client navigations it's skipped so `useHalalStatus` stays lazy + opt-in-gated (opted-out
users never fetch). The SSR result is itself ISR-cached (6h), so the Musaffa call is
amortized per page, not per visit — that ISR layer *is* the server-side cache (no KV
needed). Mirrors how the ticker loader prefetches `chartQuery`.

**Symbol keying gotcha.** Do NOT run `resolveSymbol` before a Musaffa lookup — it
canonicalizes toward Yahoo (`BRK-B`, `BTC-USD`, `HEIA.AS`). Musaffa keys by US ticker
with a dot for class shares (`BRK.B`). Use `musaffaKey` (`src/lib/halal/types.ts`):
uppercase, strip `$`, class-share dash→dot. Crypto/foreign listings won't match →
`unknown` (correct — Musaffa has no rating for them).

**Musaffa page URL gotcha.** The stock page is `https://musaffa.com/stock/<ticker>/` —
**ticker only, no exchange segment** (`musaffaUrl(ticker)` in `types.ts`). Appending the
exchange (`/stock/NOW/NYSE`) 404s. Musaffa is a SPA that soft-200s every path, so verify
a URL by rendered content, not HTTP status (a curl 200 is meaningless).

`MUSAFFA_API_KEY` (Typesense search-only key) must be set in local `.env` and Vercel
prod env. It's read-only and already ships in Musaffa's own web client; kept
server-side to keep it out of our client bundle.

## Component provenance

Where the UI came from, so it can be re-synced from canonical sources. The `ui/*`
primitives are pulled from **coss-ui** (`@coss` registry, `https://coss.com/ui/r/{name}.json`)
— Cal.com's shadcn-style component set built on **Base UI** (`@base-ui/react`).
`components.json` registers `@coss` and uses the `base-nova` style, so
`bunx --bun shadcn@latest add @coss/<name>` pulls the canonical coss component.
Re-sync a primitive by re-running that add with `--overwrite`.

Two `ui/*` files are deliberately **not** coss and must stay custom:
- `scroll-area.tsx` / `table.tsx` — custom split: the **styled scrollbar** is the
  Base UI `ScrollArea` (coss's has no scrollbar styling we want), the **edge fade**
  is chanhdai's pure-CSS `scroll-fade-effect` utility (see Scroll areas section).
  `table` wraps it for the horizontal fade. Keep on re-sync.
- `drawer.tsx` — vaul (drag-to-dismiss + background scale). coss/Base UI's Drawer
  supports the same via `Drawer.SwipeArea` + the Indent parts
  (`Drawer.Provider`/`IndentBackground`/`Indent`); a swap is feasible but unbaked.

| Local file(s) | Source |
|---|---|
| `src/components/WorkspaceRail.tsx` (and `MobileNav.tsx`, which reuses its `RailContent`) | devl.dev — https://www.devl.dev/c/layouts/workspace-rail (aesthetic reference) |
| `src/routes/c.$handle.index.tsx` (`Overview`: `StatTile` strip + `CallsList`) | devl.dev — https://www.devl.dev/c/dashboards/metrics-overview (took the stat-tile strip + recent-activity list; bklit charts dropped into the chart slots) |
| `src/components/charts/*` + `AnalyticsCharts.tsx` | bklit-ui — `@bklit` registry (`https://ui.bklit.com/r/{name}.json`), copy-in. Re-sync: `bunx --bun shadcn@latest add @bklit/<name> --overwrite` (e.g. `area-chart`, `candlestick-chart`, `line-chart`, `reference-area`). **`reference-area` pulls support files (`background`, `pattern-preset`, `visx-pattern`) and overwrites shared core — last add clobbered the `chart-formatters` intraday patch + dropped a malformed `--chart-brush-border` into `styles.css`; restore patches after any re-add. Its `referenceAreas` context field is optional because the locally-patched shells don't populate it.** |
| `src/components/ui/*` (accordion/badge/button/card/pagination/separator/spinner/switch/toggle/toggle-group) | coss-ui (`@coss` registry) — Base UI primitives. Re-sync: `bunx --bun shadcn@latest add @coss/<name> --overwrite` |
| `src/components/ui/drawer.tsx` | vaul (kept; not coss) — mobile drag-to-dismiss + background scale |
| `src/components/ui/scroll-area.tsx`, `src/components/ui/table.tsx` | Base UI `ScrollArea` (styled scrollbar) + chanhdai `scroll-fade-effect` (chanhdai.com/components/scroll-fade-effect, `@ncdai`; CSS-only edge fade in `styles.css`). `table` wraps it. Custom, not coss |
| `proof-viewer`, `CaveatsBanner`, `ChartBoundary` | app-specific, hand-built |
| `charts/cum-excess-area.tsx`, `charts/profit-loss-area.tsx` | app-specific — the creator-overview cumulative-excess curve. `CumExcessArea` composes bklit `AreaChart` + `ReferenceArea` (last-3mo band) + a custom sign-split fill-to-zero `ProfitLossArea` (bklit has no fill-to-baseline primitive). Lazy-loaded by `CumulativeExcess` (keeps motion/@visx/d3 off the route's initial bundle). |

To grab a fresh devl.dev snippet: open the component page and press `c` for code
(client-rendered — not in the page HTML).

## Icons

**`lucide-react` is the default** — coss-ui ships with it and the `ui/*` primitives
use it. Reach for it first.

**Iconify is for niche icons lucide lacks** (275k+ icons across all open-source sets).
Wired via the Tailwind v4 CSS plugin (`@plugin '@iconify/tailwind4';` in `src/styles.css`,
icon data from the dev-only `@iconify/json`). No JS import, no component — render an
icon with a dynamic Tailwind class, sized `1em` by default so it inherits `font-size`/
`text-{color}`:

```tsx
<span className="icon-[mdi--rocket-launch] text-emerald-500" />
```

Class shape is `icon-[<prefix>--<name>]` (e.g. prefix `mdi`, name `rocket-launch`). Find
icons + copy the exact class at
https://icon-sets.iconify.design (pick an icon → CSS → Tailwind CSS). Only icons whose
classes appear in the source get emitted to the output CSS — the full `@iconify/json` set
is a build-time index, not shipped. Both deps are `devDependencies`.

## Scroll areas

Any scrollable region (overflow lists, wide tables, drawer bodies) uses
`ScrollArea` (`src/components/ui/scroll-area.tsx`), **not** raw `overflow-*`. It's a
custom split: the **styled scrollbar** is the Base UI `ScrollArea` (desktop only;
native scroll on touch via `useTouchPrimary`), and the **edge fade** is chanhdai's
pure-CSS `scroll-fade-effect` (`@ncdai`). Wired into: the ticker calls table
(`ui/table.tsx`, horizontal), the proof-viewer drawer body, and the `WorkspaceRail` nav.

**The fade is scroll-driven CSS, no JS** — `scroll-fade-effect-y`/`-x` utilities in
`styles.css` apply a `mask-image` whose fade-band height/width animates with scroll
position via `animation-timeline: scroll(self)`. It masks content to **transparent**
(the surface behind shows through), so there is no mask-color to match — pass
`orientation="horizontal"` for an x-axis fade (default vertical), nothing else. The
`@property`/`@keyframes`/`@utility` block lives at the end of `styles.css`; re-sync from
the chanhdai registry (`@ncdai/scroll-fade-effect`) if upstream changes. **Firefox has no
`animation-timeline: scroll()` yet** (Safari 26+ and Chromium do), so it falls back to
the `@property` initial state: no leading fade, a static trailing fade — acceptable
degradation. Tables auto-size: the Base UI viewport is `size-full`
(needs a definite-height parent), so `ui/table.tsx` passes `viewportClassName="h-auto"`
to size to the table; a drawer body needs the drawer at a definite `h-[…]` (not
`max-h-`) for `flex-1` to bound the scroll area. Pass `scrollbarClassName` to restyle
the (desktop-only) scrollbar per-instance — e.g. the two sidebar areas (`WorkspaceRail`
nav + `RailStocks`) pass `scrollbarClassName="w-1.5"` for a thinner 6px bar (default
`w-2.5`); `twMerge` lets the `w-*` override win.

## Conventions

- **Tests run on `bun test`** (most files import `bun:test`; `pipeline/retry.test.ts`
  and `pipeline/vision.test.ts` still import `vitest` — a known inconsistency to
  reconcile). Typecheck with `bunx tsc --noEmit` (or `bun run typecheck`).
  `.github/workflows/ci.yml` gates PRs + pushes to `main` on `bun test` + typecheck.
  The `#/` alias maps to `src/`.
- The X path reuses `pipeline/prices.ts`/`pipeline/score.ts`/`src/lib/scorecard.ts`/
  the dashboard unchanged — keep new platforms emitting the `ReelCall` shape, don't fork them.
- **Crossfades blur, and overlap.** Any crossfade (one element/layer swapping for
  another) animates `filter: blur()` alongside opacity — outgoing sharpens *out*
  to a few px of blur as it fades, incoming resolves *from* blur to `blur(0)` as it
  fades in — and the enter/exit run concurrently (both layers transition at once,
  no sequential "exit fully, then enter"), so the swap reads as a soft dissolve, not
  a hard cut. Reference: the `CreatorSwitcher` tab↔combobox layer swap (`.cs-layer*`
  in `styles.css`). Honor `prefers-reduced-motion` (kill the transition, snap).
- Secrets in `.env` (gitignored): `GROQ_API_KEY`, `RETTIWT_API_KEY`,
  `FIREWORKS_API_KEY` (X text classification). Groq
  free-tier is rate-limited; `pipeline/groq.ts` backs off on 429 — expect slow
  vision/extract stages, not failures.
- Charts: bklit-ui components, vendored copy-in (shadcn-style, so not in
  `package.json`) under `src/components/charts/`, built on `@visx` + `d3`,
  rendered as SVG. Synced from the `@bklit` registry via
  `bunx --bun shadcn@latest add @bklit/<name> --overwrite`; the core (shell,
  context, grid, x-axis, tooltip, series) is shared across `area-chart`,
  `candlestick-chart`, and `line-chart`, so re-sync **all three together** —
  syncing one alone skews the shared core and breaks the others. Time-series
  charts (candlestick/line/area) need `x` as a `Date`; gauge/pie are
  categorical. Wrap charts in `ChartBoundary`. The ticker page's charts are
  `React.lazy`-split into `charts/ticker-charts.tsx` so `motion`/`@visx`/`d3`
  load on mount, off the route's initial bundle.
- **Local patches on top of the synced core** (re-apply after any re-sync — the
  registry doesn't ship them): the intraday time-of-day axis/crosshair labels
  (`intradayAwareFmt`/`isIntradaySeries`/`intradayTimeFmt` in `chart-formatters.ts`,
  wired into the `dateLabels` memo in `time-series-chart-shell.tsx` +
  `candlestick-chart.tsx` so 1D charts label "09:30" not a date); the custom
  edge-fade `scroll-area`/`table`; the `StockVsSpyLine` area wiring in
  `ticker-charts.tsx` (`AreaChart` with a filled stock `MorphArea` + a fill-less
  SPY `MorphArea` at `fillOpacity={0}`); the `morph-area.tsx` vertex-lerp path
  morph (resample to 240 pts, `animate(0,1)` rewrites `d` per frame) so the area
  reshapes on a timeframe switch instead of hard-swapping; and the marker stagger
  extensions in `markers/chart-markers.tsx` — bklit's `ChartMarkers` only does an
  on-mount entrance, so we (a) feed `MarkerGroup.animationDelay` a left→right
  cascade bounded to a fixed ~1.2s window (`STAGGER_WINDOW`, matching bklit's bar
  stagger) and (b) add a `replayKey` prop (the timeframe) folded into each group's
  React key, so the persistent area chart's markers remount and re-stagger on a
  switch (the candlestick already remounts via its `ChartCrossfade` key); and the
  run-collapsing date-pill odometer in `tooltip/date-ticker.tsx` +
  `tooltip/date-ticker-utils.ts` (`DateTickerInner` rolls `major`/`minor` `Stack`s
  independently via `buildSegments`/`segmentIndexFor`, so the major part — month for
  dates, hour for intraday — only advances when it actually changes; e.g. scrubbing
  within June keeps "June" fixed while the day rolls). `COMPACT_TICKER_THRESHOLD=500`
  so all normal timeframes (≤1Y ≈252 bars) roll; `tickerMode`/`splitLabel` handle both
  "Mon DD" and intraday "HH:MM". **bklit ships only the naive month/day-split variant**
  (threshold 60, static compact pill, breaks on time labels) — a prior resync (31acf9b)
  clobbered this patch because it wasn't listed here; the `date-ticker-utils.ts` helper
  + its test are custom (bklit doesn't ship them) and survive resync, but
  `date-ticker.tsx` itself must be re-applied. Finally, `initial={false}` on every
  `motion.path` in `pie-slice.tsx` (6 of them) — bklit ships these with an
  `animate={{ opacity }}` and no `initial`, so motion warns "animate opacity from
  undefined to 1" on every donut mount (the enter sweep is `d`-driven, not opacity,
  so skipping the opacity enter is correct); a resync drops the `initial` and the
  warning returns. Finally, the **chart loading skeletons**: bklit's `area-chart-loading`
  /`line-chart-loading` ride the chart's built-in `status="loading"`, but
  `candlestick-chart-loading.tsx` is **custom** (bklit's `CandlestickChart` has no
  `status="loading"`) — it draws neutral skeleton candles + the shared `Grid` shimmer
  sweep + the `ChartLoadingLabel` overlay, no bklit-core change, so it survives resyncs.
  The ticker route's `ChartSkeleton`/`CandleSkeleton` and the creator-overview funnel
  Suspense fallback use these sweep loaders (not plain `animate-pulse` boxes).

**Ticker headline tracks the crosshair.** Scrubbing the candlestick lifts the hovered
candle's close to the header price + colored delta (`headlineReadout` in
`src/lib/headline-readout.ts`, fed by a `HoverClose` reporter inside `PriceCandles`
that reads chart `tooltipData`); on leave it reverts to the window's last close. Delta
is always measured from the window's first bar. `PriceCandles`/`StockVsSpyLine` are
`memo`'d and their inputs (`candles`/`norm`/`callMarkers`) `useMemo`'d so per-frame
hover re-renders don't churn the charts.

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

**Dev gotcha — stale `public/datasets/`.** `prebuild.ts` populates `public/` only at
build, so in dev (`USE_DB=0`) a creator whose `public/datasets/<h>.json` is missing 404s:
`/api/dataset/<h>` falls to `staticFallback("/datasets/<h>.json", onMiss:"error")` → 404,
surfacing as a route notFound on `/c/<h>`. Happens after a fresh checkout, a new creator,
or refreshed `data/`. Fix locally with `bun run scripts/prebuild.ts`, or just
`cp data/creators/<h>/dataset.json public/datasets/<h>.json` (skips the slow OG re-render).

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

## Changelog

`CHANGELOG.md` (repo root) is the single source; the `/changelog` route renders it.
Update the markdown and push — Vercel auto-deploys and the page updates. **No code
change is needed to add an entry** (the route parses the md at build).

**Write for visitors, not engineers.** This page is public and read by people checking
finfluencer accuracy — **not** a release-notes feed for the team. Describe the *benefit*
("See whether a stock is Shariah-compliant"), never the plumbing. **Omit internal-only
changes entirely** — DB/serve-path/parity/provider/VM/CI/refactor work means nothing to a
visitor and reads as noise (the original backfill made this mistake). If a change has no
visible effect on the site, it does not belong here. Git history is the engineering log.

**When to update.** Add an entry when a *visible* feature, improvement, or noticeable fix
ships. Curated, not a commit dump. Match the voice + granularity of the existing entries.

**How to update.** Date-grouped (this project has no version tags — continuous deploy):

- Newest entry on top. Header is `## YYYY-MM-DD` (a real ISO date — the route formats it
  to `Mon D, YYYY` and tags the **first/top** entry "Latest"). Reuse today's date header
  if one exists rather than duplicating it.
- Group items under `### New` / `### Improved` / `### Fixed` (these are the display labels;
  Keep a Changelog tags `Added`/`Changed`/`Removed`/etc. also work and map to friendly
  wording — unknown tags render as-is).
- **Two tiers (maestri-style), chosen by the group tag:**
  - **Marquee features** — tags `New` / `Improved` (also `Added` / `Changed`) render each
    item as a **title + paragraph**. Author them `- **Title** — one or two plain sentences.`
  - **The specific/minor stuff** — every *other* tag (`Fixed`, `Removed`, or a custom
    `Also` / `Details`) renders as a **compact bulleted list**. Bullets can still lead with
    a bold `**Title** —`; it renders inline. Use this tier for small fixes and follow-ups,
    like maestri's "Point Releases" (`BLOCK_TAGS` in `changelog.tsx` is the dividing line).
- **Big releases get a tagline.** Put a `> one-line headline.` blockquote right under the
  date heading; the route renders it as a gradient **hero card**. Reserve it for genuinely
  notable releases — a hero on every entry dilutes it. No blockquote = no hero.
- Inline markdown renders in titles, bodies, and taglines: `[t](url)`, `` `code` ``,
  `**bold**`, `*italic*`.
- The `# Changelog` H1 + intro paragraph are ignored by the parser (page header is
  hard-coded in the route) — leave them.

**Wiring** (rarely touched): `src/lib/changelog.ts` (pure parser, has a test) →
`src/lib/changelog-data.ts` (the `?raw` import of `CHANGELOG.md`, parsed once) →
`src/routes/changelog.tsx` (timeline UI). The `?raw` import lives in the lib module on
purpose — the TanStack route-splitter can't resolve a relative `?raw` from its virtual
split module. The page has its own baked **OG card** (`kind: "changelog"` in
`src/og/render.tsx`, emitted to `public/og/changelog.png` by `prebuild.ts` alongside the
home card) — static + content-stable, so it's baked, not rendered on demand like the
creator/ticker cards.
