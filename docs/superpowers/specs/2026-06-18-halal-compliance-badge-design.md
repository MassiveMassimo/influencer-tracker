# Halal compliance surfacing — design

**Date:** 2026-06-18
**Branch:** `halal-compliance`
**Status:** approved (design), pending spec review

## Goal

Surface Musaffa Shariah-compliance status for tracked tickers, as an **opt-in**
dashboard enhancement:

- A **badge** next to a symbol wherever it appears: halal stocks get a
  `hugeicons:halal` icon; doubtful/questionable stocks get a lucide
  circle-question-mark; not-halal and unknown render nothing.
- Hovering/tapping a badge opens a **coss-ui PreviewCard** with the compliance
  verdict, a mini bklit **revenue-purity gauge**, and a link to the stock's
  Musaffa page.
- The **same PreviewCard** is rendered as a standalone section on the ticker
  page (`/t/$symbol`), since that page has no badge to hover.
- Everything (badges + ticker-page card) is gated behind a single preferences
  toggle, **off by default**.

This is display-only. It does not touch scoring, the pipeline, the DB, or the
frozen-prices contract.

## Why live, not baked

Halal status is **dynamic** — a company can flip compliance after an earnings
report changes its debt ratio or revenue mix. Baking it at `score()` time (like
`symbol-types.json`) would go stale between ingests. So this follows the
codebase's existing **"baked for scoring, live for display"** split: it mirrors
the live chart path (`fetchChart` → `chartQuery`), fetching on demand through a
server function with a short cache, server-side key, and graceful fallback.

## Data source: Musaffa Typesense

Musaffa's data is served from a Typesense search backend (no public REST API).
The VM's `stock-pipeline-v2/src/stock_pipeline_v2/shariah/musaffa_client.py` is
the reference implementation we port to TypeScript.

- **Host:** `https://0bs2hegi5nmtad4op.a1.typesense.net`
- **Endpoint:** `GET /collections/stocks_data/documents/search`
- **Auth:** header `x-typesense-api-key: <MUSAFFA_API_KEY>` (32-char search key)
- **Batch query:** `q=*`, `filter_by=id:=[`+ backtick-quoted tickers +`]`,
  `per_page=250`. The collection is keyed by `id` = ticker (US equities).

### Fields consumed (per ticker doc)

| Field | Use |
|---|---|
| `musaffaHalalRating` / `sharia_compliance` | headline verdict (`COMPLIANT` / `NON_COMPLIANT` / `QUESTIONABLE`) |
| `halal_revenue_percent` | gauge value (0–100), "revenue purity" |
| `nothalal_revenue_percent`, `doubtful_revenue_percent` | breakdown text in the card |
| `exchange` | Musaffa URL segment (e.g. `NASDAQ`) |
| `ticker` / `id` | Musaffa URL segment + match key |

All other Typesense fields (fundamentals, prices, ESG, analyst rec) are ignored
— we bake our own prices and don't need the rest.

### Status mapping

```
COMPLIANT      → "halal"
NON_COMPLIANT  → "not_halal"   (also NOT_COMPLIANT / NOT_HALAL)
QUESTIONABLE   → "doubtful"    (also DOUBTFUL)
anything else / not found → "unknown"
```

### Coverage / scope

US equities only. Crypto (the app maps `$BTC` → `BTC-USD`) and non-US symbols
won't resolve in Typesense → `unknown` → nothing renders. This is correct: there
is no Musaffa Shariah rating for crypto.

### Musaffa page URL

`https://musaffa.com/stock/<TICKER>/<EXCHANGE>` (verified to resolve, e.g.
`/stock/AAPL/NASDAQ`). Built from the doc's `ticker` + `exchange`.

## Architecture

```
HalalBadge / HalalPreviewCard         client, rendered only when
        │                              prefs.showHalalStatus === true
        │ useHalalStatus(symbols)
        ▼
halalQuery(symbols)                    TanStack Query, queryKey ["halal", sortedSymbols]
        │                              enabled: showHalalStatus && symbols.length > 0
        ▼
fetchHalal({ symbols })                createServerFn (server-only)
        │                              12h in-memory cache per symbol
        ▼
fetchMusaffa(symbols, key)             Typesense GET, batch 250, MUSAFFA_API_KEY
```

### Units

Each unit is independently testable with a clear interface.

**`src/lib/halal/musaffa.ts`** (server-only — imports nothing client-safe-sensitive)
- `parseRating(raw: string): HalalStatus` — pure status mapper.
- `musaffaUrl(ticker: string, exchange: string): string` — pure URL builder.
- `fetchMusaffa(symbols: string[], apiKey: string): Promise<MusaffaRecord[]>` —
  batched Typesense fetch. Throws `MusaffaOutage` on HTTP 5xx (caller catches).
- Types: `HalalStatus = "halal" | "doubtful" | "not_halal" | "unknown"`,
  `MusaffaRecord = { ticker, status, halalPct, notHalalPct, doubtfulPct, exchange, musaffaUrl }`.

**`src/lib/halal-fetch.ts`** (mirrors `chart-fetch.ts`)
- `fetchHalal` = `createServerFn` taking `{ symbols: string[] }`, returning
  `Record<string, HalalInfo>` keyed by canonical symbol.
- Canonicalizes each input symbol via `src/lib/symbol.ts` before querying.
- 12h in-memory cache (`Map<symbol, { info, expires }>`), per-symbol so different
  pages share cached entries (same shape as chart-fetch's `symbol:timeframe` cache).
- **Fail-open:** missing `MUSAFFA_API_KEY` or any fetch/parse error → every
  requested symbol returns `{ status: "unknown" }`; logs a warning, never throws.
  Crypto / not-found symbols also map to `unknown`.

**`src/lib/halal-query.ts`** (mirrors `chart-query.ts`)
- `halalQuery(symbols: string[])` → `queryOptions` with
  `queryKey: ["halal", [...symbols].sort()]`, `queryFn: () => fetchHalal({ symbols })`,
  `staleTime` ~12h. Consumers pass `enabled` based on the toggle.
- `useHalalStatus(symbols)` hook: reads `showHalalStatus` from preferences,
  runs `useQuery(halalQuery(symbols))` with `enabled: showHalalStatus && symbols.length`.

**`src/lib/preferences.tsx`**
- Add `showHalalStatus: boolean` to `Preferences` (default `false`).
- localStorage key `show-halal`; `setShowHalalStatus` setter following the exact
  pattern of `setReduceHaptics` (no DOM side effect).

**`src/components/Preferences.tsx`**
- One `SwitchRow`: label "Show halal status", description e.g. "Badge stocks with
  their Musaffa Shariah-compliance rating." Placed after the existing switches.

**`src/components/halal/halal-badge.tsx`**
- Props: `{ status: HalalStatus }` (info comes from the query at the call site).
- `halal` → `<span className="icon-[hugeicons--halal] …" />`;
  `doubtful` → lucide `CircleQuestionMark`; `not_halal` / `unknown` → `null`.
- Sized to inherit text size; accessible label (`aria-label`, `title`).
- Wrapped by `HalalPreviewCard` as its trigger.

**`src/components/halal/halal-preview-card.tsx`**
- Built on coss `preview-card` (added via `bunx --bun shadcn@latest add @coss/preview-card`).
- Props: `{ info: HalalInfo, children: trigger }` (popover mode) and a
  `variant="inline"` (standalone card on the ticker page, no hover trigger).
- Content: rating label + colored dot; the **revenue-purity gauge**; a one-line
  breakdown (`halal {x}% · doubtful {y}% · non-halal {z}%`); "View on Musaffa ↗".
- The gauge uses the vendored bklit `Gauge` (`src/components/charts/gauge.tsx`),
  confirmed props:
  ```tsx
  <Gauge
    value={info.halalPct}
    centerValue={info.halalPct}
    useGradient
    activeGradient={["#a855f7", "#06b6d4"]}
    inactiveGradient={["#334155", "#38bdf8"]}
    inactiveFillOpacity={0.4}
    startAngle={140}
    endAngle={400}
    notchCornerRadius={7}
    spacing={0}
    formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
    // defaultLabel intentionally omitted — gauge is small, no label
  />
  ```
  (`formatOptions` "percent" expects 0–1, so pass `halalPct/100` to `centerValue`
  if using percent style — finalize during implementation against the gauge's
  `ChartStatFlowFormat` behavior. Wrapped in `ChartBoundary` per chart convention.)
- Reduce-motion: respects the existing `prefers-reduced-motion` handling already
  baked into the bklit charts (gauge reads `useReducedMotion`).

### Wiring (all gated by `showHalalStatus`)

Badges render wherever a symbol is shown:
- `src/routes/t.$symbol.tsx` — header next to the symbol; **plus** the standalone
  `HalalPreviewCard` inline section.
- `src/routes/explore.tsx` — symbol rows.
- `src/routes/c.$handle.index.tsx` — creator call list rows.
- `src/routes/c.$handle.ticker.$symbol.tsx` — header.

Each surface collects the symbols it displays and calls `useHalalStatus(symbols)`
once, then maps badges from the returned record. When the toggle is off, the query
is disabled (no network) and nothing renders.

## Error handling

| Condition | Behavior |
|---|---|
| Toggle off | Query disabled, no fetch, no badge/card |
| `MUSAFFA_API_KEY` missing | Server fn returns all `unknown`, warns once; UI shows nothing |
| Musaffa 5xx / timeout | Caught → all requested symbols `unknown`; UI shows nothing |
| Symbol not in Typesense (crypto, non-US) | `unknown`; nothing renders |
| Partial batch (some found) | Found symbols get status; missing → `unknown` |

The feature can never break a page: worst case it renders nothing, exactly as if
the toggle were off.

## Testing (`bun test`)

- `parseRating` — every documented rating string → correct enum; junk → `unknown`.
- `musaffaUrl` — ticker + exchange → expected URL.
- `fetchHalal` — mocked `fetchMusaffa`: cache hit/miss, 12h expiry, fail-open on
  throw and on missing key, canonicalization of input symbols.
- Preferences — extend `src/lib/preferences.test.ts`: `showHalalStatus` defaults
  false, round-trips through localStorage.

Component rendering is covered by the existing visual-verification-on-main step,
not unit tests (consistent with how the app treats chart UI).

## Ops / configuration

- New secret **`MUSAFFA_API_KEY`** (32-char Typesense search key, from the VM's
  `stock-pipeline-v2/.env`):
  - local `.env` (gitignored) for dev,
  - `.env.example` entry (documented, no value),
  - Vercel **production** env var (server fn runs server-side),
  - VM `.env` if the dashboard ever runs there (not required for ingest).
- It's a Typesense **search-only** key (read-only, already shipped to Musaffa's
  own web client), so server-side use carries no write risk. Still kept server-side
  to avoid baking a third-party key into our client bundle.

## CLAUDE.md

Add a short "Halal compliance badge" section documenting: the live server-fn
approach (and why not baked), the Musaffa Typesense source + field mapping, the
opt-in toggle, the component locations, and the `MUSAFFA_API_KEY` requirement.

## Out of scope (YAGNI)

- **Flip alerting** — the VM's `flip_watch.py` already watches halal→not-halal
  transitions; the dashboard doesn't need to.
- **Not-halal styling** — deliberately renders nothing (per design decision).
- **Historical compliance charts** — Musaffa serves point-in-time values only;
  the gauge is a snapshot, not a time series.
- **Baking into the DB / dataset / parity gate** — display-only, stays live.
