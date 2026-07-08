# Standalone (cross-creator) ticker OG card

## Problem

The standalone ticker page `/t/<symbol>` (which redirects to `/t/<symbol>/all`,
served by `t.$symbol.$creator.tsx`) has **no dynamic Open Graph card** in the
cross-creator (`all`) view. `t.$symbol.$creator.tsx` builds a dynamic
`/api/og/t/<handle>/<symbol>/<rev>` card only when the view collapses to a single
creator (line ~149); the multi-creator `all` view leaves `og.img = null`, so the
page `head` falls back to the generic home `/og.png` (line ~169). Symbols called by
2+ creators therefore share a non-specific card when linked on social.

The creator card (`/api/og/c/<handle>/<rev>`) and the creator-ticker card
(`/api/og/t/<handle>/<symbol>/<rev>`) are already dynamic, runtime-rendered,
content-hash-rev'd, and ISR-cached. This adds the missing cross-creator variant
following the same pattern.

## Scope

In: a cross-creator ticker OG card for the `all` view. Out: any change to the
existing creator / creator-ticker cards or the home card; any change to the page UI.

## Design

### 1. New render kind — `src/og/render.tsx`

Add to the `OgCard` union:

```ts
| {
    kind: "ticker-all";
    theme: OgTheme;
    symbol: string;
    company?: string;
    creatorCount: number;
    callCount: number;
    avgExcess: number | null; // fraction, e.g. 0.124 — avg 3-month excess vs SPY
    closes?: number[];         // symbol price series for the line-graph background
  }
```

Renders the same layout as `kind: "ticker"` (symbol + company headline, the
price line-graph background when `closes` is present, the excess stat) with one
difference: the byline reads **"{creatorCount} creators · {callCount} calls"**
instead of a single creator's name/avatar. `avgExcess` is formatted with the same
signed-percent helper the `ticker` card uses for `excess3m`; `null` renders the
neutral/empty treatment already used when `excess3m` is null. The price-background
branch (`render.tsx` ~line 221) is extended to also fire for `kind === "ticker-all"`
when `closes.length > 0`. The resvg/dimensions/font switches that currently test
`card.kind === "ticker"` also accept `"ticker-all"` (same 1200×630 card).

### 2. New route — `src/routes/api/og/t.$symbol.$rev.tsx`

A 2-param route (`/api/og/t/$symbol/$rev`) — distinct from the 3-param
`/api/og/t/$handle/$symbol/$rev` by segment count, so no routing collision. Mirrors
`t.$handle.$symbol.$rev.tsx`:

```
GET ({ params: { symbol, rev } }):
  if (!isSafeAssetKey(symbol)) return 404
  fetch calls-index + prices(symbol) in parallel
  summary = summarizeTicker(callsIndex, symbol)
  renderOgPng({ kind: "ticker-all", theme: "dark",
    symbol, company: summary.company,
    creatorCount: summary.creatorCount, callCount: summary.callCount,
    avgExcess: summary.avgEx3m, closes: prices.map(p => p.c) })
  → 200 image/png, Cache-Control: CACHE_CONTROL
  on any error: console.warn + minimal card
    renderOgPng({ kind: "ticker-all", theme: "dark", symbol,
      creatorCount: 0, callCount: 0, avgExcess: null })
```

`$rev` is unused in the handler (cache-bust only), matching the sibling routes.
Data comes from `fetchCallsIndex` (cross-creator source) + `fetchPrices`, both
already used by the page loader.

### 3. Wire the page — `src/routes/t.$symbol.$creator.tsx`

In the loader's `og` computation, the existing single-creator branch (line ~149)
is unchanged. Add the `all`-view fallback: when there is no single `creatorHandle`,
set

```ts
og.img = siteUrl(
  `/api/og/t/${symbol}/${ogRev([
    summary.creatorCount,
    summary.callCount,
    summary.avgEx3m,
    Math.round(bakedOhlc.at(-1)?.c ?? 0),
  ])}`,
);
```

so `head` (line ~169) emits this URL instead of `/og.png`. `og.title` for the
`all` view stays as-is. The rev hashes the same aggregates the card displays plus
the last close, so any data change (new call, matured return, new price bar) busts
the CDN entry.

## Error handling

Route fail-opens to a minimal symbol-only card on any fetch/render error (matches
`t.$handle.$symbol.$rev.tsx`). The page never blocks on OG: if the loader can't
compute a rev it keeps the `/og.png` fallback.

## Testing

- `src/og/render.test.ts` (or the existing `renderOgPng` test file): add a
  `ticker-all` case asserting `renderOgPng` returns a non-empty PNG buffer (magic
  bytes `89 50 4E 47`), one with `closes` and one without (minimal card).
- Existing `summarizeTicker` tests already cover the aggregates the card reads; no
  new data-layer test needed.

## Out of scope / non-goals

- No new data fetching on the page (the loader already calls `fetchCallsIndex` +
  has `bakedOhlc`).
- No baked/prebuild PNG for `/t/<symbol>` — this is the runtime path only, matching
  the other dynamic cards.
