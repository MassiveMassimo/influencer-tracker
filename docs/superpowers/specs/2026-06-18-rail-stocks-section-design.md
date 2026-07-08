# Rail "Stocks" section (1D sparklines) — design

Date: 2026-06-18
Branch: `ticker-primary` (sequenced **after** the ticker-primary page plan — the row
click target is `/t/$symbol/$creator`, created there)

## Problem

The workspace rail lists creators. Now that the stock ticker is a top-level entity
(`/t/$symbol/$creator`), the rail should also offer a browsable **Stocks** list —
the recently-called tickers, each with a Robinhood/Yahoo-style **1D intraday
sparkline** colored by the day's move — so a viewer can jump straight to a stock.

## Approach

Split cheap-static list (SSR) from live 1D data (client, batched, cached):

- **List** — derived from `fetchCallsIndex()` in the **root loader** (`__root.tsx`,
  which already loads `listCreators()`): aggregate per-ticker max `postDate`, sort
  desc, take the **top 20**, project to `{ symbol, company, lastCall }`. Passed to
  `WorkspaceRail` / `RailContent` next to `creators`. Renders immediately at SSR.
- **1D sparklines** — fetched **client-side, lazily, batched**:
  - New server fn `fetch1DSparks({ symbols })` (`src/lib/spark-fetch.ts`, mirrors
    `chart-fetch.ts`): one upstream request to Yahoo's **multi-symbol** v7 spark
    endpoint (`/v7/finance/spark?symbols=A,B,C&range=1d&interval=5m`) → per symbol
    `{ changePct, closes: number[] }` (closes downsampled to ≤24). 5-min in-memory
    TTL cache (reuse the `cacheGet`/`cacheSet` pattern). **Fail-open per symbol:** a
    missing/malformed entry is omitted, never throws; a whole-endpoint failure
    returns `{}`.
  - Client query `sparks1dQuery(symbols)` (`src/lib/spark-query.ts`, TanStack Query,
    `staleTime` 2 min, `enabled: symbols.length > 0`). One query for all 20.
  - `changePct = (lastClose − previousClose) / previousClose` using the spark meta's
    `chartPreviousClose`/`previousClose`; fall back to first close if absent.

### Why this is efficient (the watchlist-UI pattern)

1. **One client request**, not 20 — a single server fn / single TanStack query.
2. **One upstream request** — Yahoo's spark endpoint is natively multi-symbol.
3. **Coarse interval** (5-min bars, ~30–80 pts) downsampled to ≤24 — tiny payload.
4. **Cached** server-side (5 min) + client (2 min stale); refetch on focus, not per
   render. The rail is global (every page), so caching is what keeps it cheap.

## UI

- **Rail layout** (`RailContent`): top nav stays fixed; below it, **two independent
  scroll regions** sharing the flex space — Creators (existing) and **Stocks** (new),
  each its own **lina `ScrollArea`** (per the project rule that all scroll areas use
  lina). Each gets `maskColor` matching the rail surface (the rail overlay reads as
  `--background`, so the default mask is correct — mirror the existing ScrollArea).
- **Stock row** (`Link to="/t/$symbol/$creator" params={{ symbol, creator: "all" }}`):
  `@SYMBOL` · truncated company · `<Sparkline closes={intraday} excess={changePct} />`
  · compact colored `+x.x%` chip (tone by `changePct`). Before the query resolves:
  a faint skeleton sparkline placeholder (no layout shift).
- Reuses `src/components/Sparkline.tsx` unchanged in API.

## Sparkline gradient fill + smoothed joints (enhancement, shared)

Two `Sparkline.tsx` tweaks. The component is **also** used in the creator call table
(`c.$handle.index.tsx:461`), so both apply there too (intended; consistent, nicer).

1. **Gradient area fill** under the line, fading to transparent at the bottom
   (standard watchlist look): an SVG `<linearGradient>` (vertical, stop-0 = line color
   at ~0.25 opacity → stop-1 transparent) + a filled `<path>` that closes the line down
   to the baseline, drawn _under_ the stroke path. The gradient id must be unique per
   instance (multiple sparklines per page) — derive from `useId()`.
2. **Smoothed joints** — the line currently draws straight `L` segments between points
   (`strokeLinejoin="round"` only softens the stroke corner). Replace the polyline with
   a lightly smoothed curve so vertices read as gentle curves, not angular kinks. Use a
   simple Catmull-Rom → cubic-bézier conversion with a low tension (build `C` segments
   from neighbouring points); keep `strokeLinejoin/Linecap="round"`. The filled area
   path uses the same smoothed top edge.

## Data / lib changes

- `src/lib/rail-stocks.ts` (new): pure `topStocksByLastCall(index, max=20)` →
  `{ symbol, company, lastCall }[]`. Unit-testable.
- `src/lib/spark-fetch.ts` (new): `fetch1DSparks` server fn + a pure parser
  `parseSparkResponse(json)` → `Record<symbol, { changePct, closes }>` (unit-testable
  against a captured-shape fixture).
- `src/lib/spark-query.ts` (new): `sparks1dQuery(symbols)` query options.
- `src/components/RailStocks.tsx` (new): the section (list + lazy sparkline query).
- `src/components/Sparkline.tsx` (modify): gradient fill.
- `src/components/WorkspaceRail.tsx` (modify): accept `stocks`, render `RailStocks`
  in its own scroll region; thread through `RailContent` + `MobileNav`.
- `src/routes/__root.tsx` (modify): root loader returns `{ creators, stocks }`; pass
  `stocks` to `WorkspaceRail` + `MobileNav`.

## Error handling / fallbacks

- Spark endpoint failure → query returns `{}`; rows render with no sparkline + a
  muted "—" delta. List itself is unaffected (it's static from the loader).
- Empty stock list (no calls yet) → section shows "No stocks yet" (mirror the
  creators-empty copy).
- Symbol safety: `fetch1DSparks` validates each symbol with `isSafeAssetKey` before
  concatenating into the Yahoo URL (same guard as `chart-fetch.ts`).

## Testing

- `rail-stocks.test.ts`: `topStocksByLastCall` ordering + cap + company carry.
- `spark-fetch.test.ts`: `parseSparkResponse` against a fixture (one good symbol, one
  null-closes symbol → omitted, prevClose-based changePct).
- Components verified by typecheck + visual pass on `main` (repo has no render harness).

## Out of scope (YAGNI)

- Polling/auto-refresh beyond TanStack focus refetch.
- Per-stock 52-week or multi-day mini charts (1D only).
- Search/filter within the Stocks list (the top-20 cap keeps it short).
- Persisting a user-pinned watchlist.
