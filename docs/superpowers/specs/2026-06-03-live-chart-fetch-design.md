# Live chart fetch — design

**Date:** 2026-06-03
**Project:** influencer-tracker
**Status:** approved (design phase)

## Problem

Ticker-page charts read OHLC baked into `dataset.json` at pipeline `score` time
(`pipeline/prices.ts`, Yahoo daily, `interval: "1d"`). Daily-only data caps candle
count at one per day, so short timeframes are degenerate (1D ≈ 1–2 candles). A
normal stock-ticker app fetches finer-grained data live. We want that for the
charts without disturbing scoring.

## Decisions (locked)

- **Scope: chart-only live.** Scoring (hit-rate, excess-vs-SPY) stays frozen in
  `dataset.json` — recomputing it live would make a creator's accuracy drift
  between refreshes. Only the price + vs-SPY charts fetch live.
- **Freshness: fresh-on-load.** Fetch on page open, cache a few minutes, no
  background polling. This is an accuracy tracker, not a day-trading terminal.
- **Data source: Yahoo via `yahoo-finance2`** (already a dependency). Research
  confirmed it is the best free option for intraday density with no key/signup:
  Twelve Data free is EOD-only, Alpha Vantage free is 25 calls/day, Finnhub
  candles moved to premium. Yahoo intraday caps (1m ≤ 8d, ≤1h ≤ 730d) cover all
  our windows. Risk: unofficial, can break — mitigated by the baked fallback.
- **Sub-decision A: drop the zoom/scroll-pan model.** With per-timeframe
  native-density ranges, each tab *is* the window; there's nothing to pan to.
- **Sub-decision B: fall back to baked daily OHLC on Yahoo error** — the baked
  series is already in the loader, so this is free resilience.

## Architecture

```
dataset.json (baked, frozen)  ──►  loader ──►  calls, scorecard, returns table,
                                                marker metadata, ProofViewer
                                                (UNCHANGED)

fetchChart server fn (Yahoo, live)  ──►  useQuery  ──►  price chart + vs-SPY chart OHLC
        │                                                       ▲
        └─ in-memory TTL cache (~5 min, per symbol:interval)    └─ baked OHLC on error
```

Only the two charts' OHLC switch from baked to live. Everything else on the page
keeps reading the frozen dataset.

### Components / units

1. **`chartWindow(tf)`** — pure, unit-tested. Maps a `Timeframe` to a Yahoo
   `{ interval, period1 }`. No I/O. Lives with the server module but exported for
   tests.

   Mapping follows the retail-app standard (Robinhood/Google Finance): pick the
   interval that lands ~40–400 candles in view — dense enough to read, not noise.
   Intraday only for windows that fit Yahoo's sub-daily cap; daily beyond.

   | TF  | interval | range            | ~bars |
   |-----|----------|------------------|-------|
   | 1D  | `5m`     | last trading day | ~78   |
   | 1W  | `30m`    | 7d               | ~65   |
   | 1M  | `1h`     | 30d              | ~150  |
   | 3M  | `1d`     | 90d              | ~63   |
   | 6M  | `1d`     | 180d             | ~126  |
   | 1Y  | `1d`     | 365d             | ~252  |
   | All | `1d` (`1wk` if range > 2y) | since first call | varies |

   **Yahoo constraint (critical):** sub-daily intervals are only served for the
   **last ~60 days**. So intraday is restricted to 1D/1W/1M (all ≤ 60d); 3M/6M/1Y
   use `1d`. Using `1h` for 3M+ would return truncated/empty data. This also
   removes the density discontinuity (no window denser than a shorter one) and
   matches what Robinhood ships. `1D` uses the last *trading* day (not literal
   today) so off-hours/weekends still render the last session.

2. **`fetchChart` server fn** — `src/lib/chart.server.ts`.
   `createServerFn({ method: 'GET' }).inputValidator(z.object({ symbol, timeframe })).handler(...)`.
   Runs server-side (keeps `yahoo-finance2` out of the client bundle, solves CORS,
   no key needed). Fetches `symbol` + `SPY` in parallel via `Promise.all`. Returns
   `{ ohlc: LiveBar[], spy: LiveBar[], interval, asOf }`.
   - `LiveBar` is a local type carrying an ISO datetime `date` (intraday needs
     time-of-day). It is **separate** from the dataset's date-only `OhlcBar` so the
     Zod `DatasetSchema` is untouched. Charts already do `new Date(b.date)`, so an
     ISO datetime string works directly.
   - **In-memory TTL cache:** module-scope `Map<string, { data, at }>`, ~5 min,
     keyed `symbol:interval`. Many viewers of the same ticker collapse to one Yahoo
     hit. Per server instance (acceptable for hobby/single-node; on serverless it's
     per-instance, still a net win).

3. **`chartQuery(symbol, timeframe)`** — `queryOptions` factory.
   `queryKey: ["chart", symbol, timeframe]`, `queryFn: () => fetchChart({ data })`,
   `staleTime: 5 * 60_000`. Shared by loader prefetch and the component so SSR data
   is reused without a double fetch.

4. **Router wiring** (per confirmed current APIs, versions: router 1.170,
   start 1.168, ssr-query 1.167, react-query 5.100):
   - `src/router.tsx`: `const queryClient = new QueryClient()` →
     `createRouter({ ..., context: { queryClient } })` →
     `setupRouterSsrQueryIntegration({ router, queryClient })`. (This is the current
     form; it replaced the older `routerWithQueryClient` HOC.)
   - `src/routes/__root.tsx`: switch `createRootRoute` →
     `createRootRouteWithContext<{ queryClient: QueryClient }>()`.
   - Add `@tanstack/react-query` as a direct dependency (already present in
     `bun.lock` transitively).

5. **Ticker route** — `src/routes/c.$handle.ticker.$symbol.tsx`:
   - Loader keeps `getDataset` AND adds
     `context.queryClient.ensureQueryData(chartQuery(params.symbol, "1Y"))` so the
     default timeframe is SSR-prefetched (no first-load spinner).
   - Component: `timeframe` stays local state; `const { data, isPending, isError } =
     useQuery(chartQuery(symbol, timeframe))`. Chart OHLC comes from `data ??
     bakedFallback`. Rebase vs-SPY to the first bar of the **fetched** range.
   - **Remove** `zoomMultiplier`, `trackWidth`, the dual-viewport scroll-sync
     `useLayoutEffect`s, and the `ScrollArea` wrappers around the charts. Charts
     render at a single viewport width again.

### Loading / error UX

- `isPending` → fixed-height (320px) chart skeleton/shimmer.
- `isError` (or empty result) → render the baked daily OHLC from
  `ds.tickers[symbol]?.ohlc` with a small "showing cached daily data" note; offer a
  retry (`refetch`).
- Re-selecting an already-fetched timeframe → instant (Query client cache).

## What stays unchanged

- `pipeline/prices.ts`, `pipeline/score.ts`, `DatasetSchema`, scoring math.
- Calls table, scorecard, funnel, ProofViewer, call markers, marker hover card.
- `window-series.ts` stays (its `windowSeries` remains unit-tested) — just no
  longer imported by the ticker route. `zoomMultiplier` becomes unused; leave it
  unless cleanup is trivial.

## Testing

- `bun test` on `chartWindow(tf)`: every timeframe returns a valid Yahoo interval
  and a `period1` within Yahoo's caps; intraday intervals only for windows ≤ 60d
  (1D/1W/1M), `1d` for 3M+; `1D` resolves to the last trading day on a weekend.
- Server fn kept logic-light; no network calls in tests (mapping is the tested
  unit; the Yahoo call itself is integration, not unit-tested).
- `bunx tsc --noEmit` clean; existing suite green.

## Performance

- SSR prefetch of the default timeframe → no spinner on initial load.
- Server-side TTL cache → repeat viewers / timeframe flips don't re-hit Yahoo.
- TanStack Query client cache → instant re-selection of cached windows.
- Parallel symbol + SPY fetch → one round-trip of latency, not two.
- Payload: worst case 1Y @ 1d ≈ ~252 bars × 2 symbols, or 1M @ 1h ≈ ~150 × 2 —
  both well under ~50 KB JSON. Downsampling is YAGNI.

## Out of scope

- Polling / websockets / real-time streaming.
- Changing scoring to live data.
- Multi-node shared cache (Redis/edge KV) — revisit only if deployed to scale.
