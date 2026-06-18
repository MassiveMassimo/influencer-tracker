# Halal compliance surfacing — design

**Date:** 2026-06-18
**Branch:** `halal-compliance`
**Status:** approved (design), revised after Opus spec review

## Goal

Surface Musaffa Shariah-compliance status for tracked tickers, as an **opt-in**
dashboard enhancement:

- A **badge** next to a symbol wherever it appears: halal stocks get a
  `hugeicons:halal` icon; doubtful/questionable stocks get a lucide
  circle-question-mark; not-halal and unknown render nothing.
- Hovering/tapping a badge opens a **coss-ui PreviewCard** with the compliance
  verdict, a mini bklit **revenue-purity gauge**, and a link to the stock's
  Musaffa page.
- The **same card content** is rendered as a standalone section on the
  symbol page (`/t/$symbol`), since that page has no badge to hover.
- Everything (badges + symbol-page card) is gated behind a single preferences
  toggle, **off by default**.

This is display-only. It does not touch scoring, the pipeline, the DB, or the
frozen-prices contract.

## Why live, not baked

Halal status is **dynamic** — a company can flip compliance after an earnings
report changes its debt ratio or revenue mix. Baking it at `score()` time (like
`symbol-types.json`) would go stale between ingests. So this follows the
codebase's existing **"baked for scoring, live for display"** split: a server
function fetches on demand with a server-side key and a fail-open fallback, and
the client caches via TanStack Query. (See "Caching" — this is *not* a copy of
`fetchChart`'s SSR-prefetch path; the feature is client-gated, so there is no SSR
prefetch.)

## Data source: Musaffa Typesense

Musaffa's data is served from a Typesense search backend (no public REST API).
The VM's `stock-pipeline-v2/src/stock_pipeline_v2/shariah/musaffa_client.py` is
the reference implementation we port to TypeScript.

- **Host:** `https://0bs2hegi5nmtad4op.a1.typesense.net`
- **Endpoint:** `GET /collections/stocks_data/documents/search`
- **Auth:** header `x-typesense-api-key: <MUSAFFA_API_KEY>` (32-char search key)
- **Batch query:** `q=*`, `filter_by=id:=[` + backtick-quoted keys + `]`,
  `per_page=250`. The collection is keyed by `id` = US-equity ticker.

### Fields consumed (per ticker doc)

| Field | Use |
|---|---|
| `musaffaHalalRating` / `sharia_compliance` | headline verdict (`COMPLIANT` / `NON_COMPLIANT` / `QUESTIONABLE`) |
| `halal_revenue_percent` | gauge value (0–100), "revenue purity" |
| `nothalal_revenue_percent`, `doubtful_revenue_percent` | breakdown text in the card |
| `exchange` | Musaffa URL segment (e.g. `NASDAQ`) |
| `ticker` / `id` | Musaffa URL segment + match key |

All other Typesense fields (fundamentals, prices, ESG, analyst rec) are ignored.

### Status mapping

```
COMPLIANT      → "halal"
NON_COMPLIANT  → "not_halal"   (also NOT_COMPLIANT / NOT_HALAL)
QUESTIONABLE   → "doubtful"    (also DOUBTFUL)
anything else / not found → "unknown"
```

### Symbol → Musaffa key (do NOT use `resolveSymbol`)

**Critical correction from review.** `src/lib/symbol.ts` `resolveSymbol`
canonicalizes *toward Yahoo* notation: `$BTC`→`BTC-USD`, and via OVERRIDES
`HEIA`→`HEIA.AS`. Musaffa is keyed by the **US-equity ticker**, and uses a **dot**
for class shares (verified: `BRK.B` matches, `BRK-B`/`BRKB` do not). So we must
NOT canonicalize before querying Musaffa.

The app renders symbols in their stored/Yahoo-canonical form. `musaffaKey(symbol)`
derives the lookup key from that:

- uppercase, strip a leading `$`;
- class shares: `^[A-Z]+-[A-Z]$` → convert dash to dot (`BRK-B` → `BRK.B`);
- everything else passed through unchanged.

Crypto (`BTC-USD`) and non-US (`HEIA.AS`) keys will not match a US-ticker `id`
→ `unknown` → nothing renders. That is correct: Musaffa has no rating for crypto
or foreign listings. Fail-open covers any other miss.

### Input validation (injection guard)

Tickers are backtick-quoted into `filter_by`, so every key is validated against
the same allowlist the chart path uses (`isSafeAssetKey`, `src/lib/api-serve.ts`
— `^[A-Za-z0-9.$!_-]{1,40}$`) before being placed in the filter. Anything failing
the check is dropped to `unknown`, never sent.

### Musaffa page URL

`https://musaffa.com/stock/<TICKER>/` — ticker only, no exchange segment
(verified against musaffa.com's own links, e.g. `/stock/NVDA/`, `/stock/BRK.B/`,
`/stock/RELIANCE.NS/`). Appending the exchange (`/stock/NOW/NYSE`) 404s — the SPA
soft-200s every path, so resolution must be checked by rendered content, not status.

## Architecture

```
HalalBadge / HalalCardContent          client, rendered only when
        │                               prefs.showHalalStatus === true
        │ useHalalStatus(symbols)        (so SSR/first-paint render nothing — see Hydration)
        ▼
halalQuery(symbols)                     TanStack Query
        │                               queryKey ["halal", sortedSymbols], staleTime 12h
        │                               enabled: showHalalStatus && symbols.length > 0
        ▼
fetchHalal({ symbols })                 createServerFn (server-only)
        │                               best-effort in-memory dedup cache (~5 min)
        ▼
fetchMusaffa(keys, apiKey)              Typesense GET, batch 250, MUSAFFA_API_KEY
```

### Units

**`src/lib/halal/musaffa.ts`** (server-only)
- `parseRating(raw: string): HalalStatus` — pure status mapper.
- `musaffaKey(symbol: string): string` — pure symbol→lookup-key (rules above).
- `musaffaUrl(ticker: string): string` — pure URL builder (ticker only, no exchange).
- `fetchMusaffa(keys: string[], apiKey: string): Promise<MusaffaRecord[]>` —
  batched Typesense fetch; validates keys with `isSafeAssetKey` before quoting;
  throws `MusaffaOutage` on HTTP 5xx (caller catches).
- Types: `HalalStatus = "halal" | "doubtful" | "not_halal" | "unknown"`;
  `MusaffaRecord`/`HalalInfo = { status, halalPct, notHalalPct, doubtfulPct, exchange, musaffaUrl }`.

**`src/lib/halal-fetch.ts`**
- `fetchHalal` = `createServerFn` taking `{ symbols: string[] }`, returning
  `Record<string, HalalInfo>` keyed by the **input symbol** (so the client can
  look up by the symbol it rendered).
- Maps each input symbol → `musaffaKey`, fetches, joins results back to the
  original symbols (unmatched → `{ status: "unknown" }`).
- **Best-effort dedup cache:** in-module `Map<musaffaKey, { info, expires }>`,
  ~5-min TTL + small entry cap — same structure and intent as `chart-fetch.ts`
  (collapse the concurrent / repeated server hits within a warm instance). It is
  **not** a durable cache: on Vercel Fluid/serverless the Map evaporates on cold
  start, which is fine — real client-side reuse comes from the TanStack Query
  `staleTime` (12h) below, not from the server Map.
- **Fail-open:** missing `MUSAFFA_API_KEY` or any fetch/parse error → every
  requested symbol returns `{ status: "unknown" }`; logs a warning once; never throws.

**`src/lib/halal-query.ts`**
- `halalQuery(symbols: string[])` → `queryOptions` with
  `queryKey: ["halal", [...symbols].sort()]`, `queryFn: () => fetchHalal({ symbols })`,
  `staleTime: 12h`, `gcTime: 24h`. Consumers set `enabled` from the toggle.
- `useHalalStatus(symbols)` hook: reads `showHalalStatus`, runs
  `useQuery(halalQuery(symbols))` with `enabled: showHalalStatus && symbols.length`,
  returns `(symbol) => HalalInfo | undefined`.
- **Caching trade-off (accepted):** the query key is the *sorted symbol set*, so
  two pages with overlapping-but-different sets are distinct client cache entries
  and refetch. That is acceptable because the server-fn's per-key Map makes the
  overlap cheap (already-seen keys resolve from the warm Map) and most surfaces
  (creator page, symbol page) have small, stable sets. Explore's larger/variable
  set is the one page that refetches on filter changes — acceptable for an
  opt-in display feature; revisit with per-symbol `useQueries` only if it bites.

**`src/lib/preferences.tsx`**
- Add `showHalalStatus: boolean` to `Preferences` (default `false`).
- localStorage key `show-halal`; `setShowHalalStatus` following `setReduceHaptics`
  exactly (no DOM side effect). Hydrated in the existing mount `useEffect`.

**`src/components/Preferences.tsx`**
- One `SwitchRow`: "Show halal status" / "Badge stocks with their Musaffa
  Shariah-compliance rating." after the existing switches.

**`src/components/halal/halal-badge.tsx`**
- Props `{ info: HalalInfo }`. `halal` → `<span className="icon-[hugeicons--halal] …"
  role="img" aria-label="Shariah-compliant (Musaffa)" />`; `doubtful` → lucide
  `CircleQuestionMark` with `aria-label="Shariah compliance questionable (Musaffa)"`;
  `not_halal` / `unknown` → `null`. Inherits text size.
- Wrapped by the PreviewCard trigger; trigger is a real `<button>` so it is
  keyboard-focusable and tap-operable (Base UI PreviewCard is hover-oriented;
  the button gives focus/tap parity on mobile).

**`src/components/halal/halal-card-content.tsx`**
- Presentational, props `{ info: HalalInfo }`. Renders rating label + colored dot,
  the revenue-purity gauge, the one-line breakdown
  (`halal {x}% · doubtful {y}% · non-halal {z}%`), and "View on Musaffa ↗".
- Reused by **both** the PreviewCard popover body and the symbol-page inline
  section — no `variant` prop forcing one primitive into two modes (review N2).

**`src/components/halal/halal-preview-card.tsx`**
- coss `preview-card` (`bunx --bun shadcn@latest add @coss/preview-card`),
  wrapping `HalalBadge` as trigger and `HalalCardContent` as body.

**Gauge config (corrected — review B2).** `Gauge.value` is the 0–100 fill level
(correct as `halalPct`), but `centerValue` is formatted by `Intl.NumberFormat`,
and `style:"percent"` multiplies by 100. So pass the fraction:
```tsx
<ChartBoundary>
  <Gauge
    value={info.halalPct}                       // 0–100 fill
    centerValue={info.halalPct / 100}           // fraction; percent style ×100 → "95%"
    formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
    useGradient
    activeGradient={["#a855f7", "#06b6d4"]}
    inactiveGradient={["#334155", "#38bdf8"]}
    inactiveFillOpacity={0.4}
    startAngle={140}
    endAngle={400}
    notchCornerRadius={7}
    spacing={0}
    // defaultLabel omitted — gauge is small, no label
  />
</ChartBoundary>
```
Gauge already respects `prefers-reduced-motion` (`useReducedMotion` in `gauge.tsx`).

### Wiring (all gated by `showHalalStatus`)

Badges render wherever a symbol is shown:
- `src/routes/t.$symbol.tsx` — header next to the symbol; **plus** the standalone
  `HalalCardContent` inline section. Client-fetched via `useHalalStatus([symbol])`;
  **no loader/SSR prefetch** (this route has no QueryClient loader today, and the
  feature is client-gated anyway).
- `src/routes/explore.tsx` — symbol rows.
- `src/routes/c.$handle.index.tsx` — creator call list rows.
- `src/routes/c.$handle.ticker.$symbol.tsx` — header.

Each surface collects its displayed symbols and calls `useHalalStatus(symbols)`
once. Toggle off → query disabled → no network, nothing rendered.

## Hydration / SSR (review S4)

`showHalalStatus` is read from localStorage, which is server-blind:
`readStoredPrefs` returns `DEFAULTS` (false) on the server and hydrates in a mount
`useEffect`. Therefore:
- **SSR and first client render are identical** (toggle off → badges/card render
  nothing) → no hydration mismatch.
- For opted-in users, badges/card **appear after hydration** (a deliberate
  pop-in, exactly how theme / reduce-motion already behave). There are no SSR
  badges even when opted in.
- **Do not** read localStorage during render to "fix" the pop-in — that
  reintroduces a hydration mismatch (the codebase already carries React #418
  scars in the chart code). The mount-effect pattern is the contract.

## Error handling

| Condition | Behavior |
|---|---|
| Toggle off | Query disabled, no fetch, no badge/card |
| `MUSAFFA_API_KEY` missing | Server fn returns all `unknown`, warns once |
| Musaffa 5xx / timeout | Caught → all requested symbols `unknown` |
| Symbol not in Typesense (crypto, non-US, class-share miss) | `unknown` |
| Invalid symbol (fails `isSafeAssetKey`) | dropped to `unknown`, never queried |
| Partial batch | found symbols get status; missing → `unknown` |

The feature can never break a page: worst case it renders nothing, exactly as if
the toggle were off.

## Testing (`bun test`)

- `parseRating` — every documented rating string → enum; junk → `unknown`.
- `musaffaKey` — `AAPL`→`AAPL`, `BRK-B`→`BRK.B`, `$BTC`→`BTC` (won't match),
  `HEIA.AS` passthrough; lower-case input handled.
- `musaffaUrl` — ticker → expected URL (`/stock/<ticker>/`).
- `fetchHalal` — mocked `fetchMusaffa`: cache hit/miss + ~5-min expiry, fail-open
  on throw and on missing key, symbol→key mapping, join-back of unmatched → unknown,
  `isSafeAssetKey` rejection.
- **Gauge scaling guard** — a unit assertion that the card passes
  `centerValue = halalPct/100` (regression guard for B2).
- **Badge server render** — `HalalBadge`/card render `null` (or nothing) when
  the toggle path is off / status unknown (regression guard for S4).
- Preferences — extend `preferences.test.ts`: `showHalalStatus` defaults false,
  round-trips through localStorage.

## Visual verification (project workflow)

Per the worktree rule, badge/gauge/card visuals are verified **on `main` after
merge** (single local dev server), with the toggle on. B2 (gauge number) and S4
(post-hydration appearance) only manifest in a real browser, so this pass is
required, not optional. Build/typecheck/`bun test` run in the worktree first.
(Note: `IntersectionObserver`-gated reveals don't fire under browser automation —
verify the live badge/gauge in a real browser, per CLAUDE.md.)

## Ops / configuration

- New secret **`MUSAFFA_API_KEY`** (32-char Typesense **search-only** key, read-only;
  it already ships in Musaffa's own web client). Sourced from the VM's
  `stock-pipeline-v2/.env`. Add to: local `.env` (gitignored), `.env.example`
  (documented, no value), Vercel **production** env. Kept server-side only to
  avoid baking a third-party key into the client bundle.

## CLAUDE.md

Add a short "Halal compliance badge" section: live server-fn approach (and why
not baked), Musaffa Typesense source + field/status mapping, the `musaffaKey`
(dot class shares, no `resolveSymbol`) gotcha, the opt-in toggle, component
locations, and the `MUSAFFA_API_KEY` requirement.

## Out of scope (YAGNI)

- **Flip alerting** — the VM's `flip_watch.py` already watches transitions.
- **Not-halal styling** — deliberately renders nothing.
- **Historical compliance charts** — Musaffa serves point-in-time only; the gauge
  is a snapshot.
- **Durable server-side cache** — best-effort Map + client `staleTime` is enough
  for an opt-in display feature; no KV / Runtime Cache unless explore refetch bites.
- **Baking into DB / dataset / parity gate** — display-only, stays live.
