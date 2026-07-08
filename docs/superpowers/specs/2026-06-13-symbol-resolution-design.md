# Symbol Resolution & Priceability Gate — Design

Date: 2026-06-13
Status: approved (design), pending implementation plan
Branch: `symbol-resolution`

## Problem

A ticker page renders an empty chart (just the "PRICE" label + a faint grid
line) or, worse, crashes the entire route with "Something went wrong / No data
found, symbol may be delisted".

Root cause: a raw, LLM-extracted ticker string is used **directly** as a Yahoo
symbol in two independent places — the baked-scoring path (`pipeline/prices.ts`)
and the live-chart path (`src/lib/chart-fetch.ts`) — with **no canonical
symbol resolution** and **no priceability gate**. Misformatted or out-of-scope
symbols therefore flow all the way through:

- **Crypto in the wrong notation** — `BTCUSD`, `BTCUSDT`, `BTC.X`, `$ETH.X`,
  `ETHUSD`, `ETH.X`. Yahoo uses `BTC-USD` / `ETH-USD`. Bitcoin is currently
  **fragmented across three symbols** and Ethereum across three.
- **Crypto resolving to the WRONG asset (silent corruption, not empty)** — the
  bare symbols `BTC` (×1) and `ETH` (×4 calls) currently resolve on Yahoo to the
  **Grayscale Mini Trust ETFs** (NYSEARCA `BTC` ≈ $48, `ETH` ≈ $24), not spot
  crypto. `data/prices/BTC.json` / `ETH.json` are non-empty (255 bars each) and
  hold those ETF prices; `dataset.json` scores `ticker:"BTC" company:"Bitcoin"`
  forward-returns against a $48 ETF instead of a $108k asset. These are
  **populated-but-wrong**, so the empty-file scan missed them — they render a
  (wrong) chart rather than an empty one.
- **Foreign listing missing its suffix** — `HEIA` (Heineken, Amsterdam) is
  `HEIA.AS` on Yahoo.
- **Out-of-scope notations** — TradingView futures `SI1!`, CFD `SPCFD`.
- **Genuinely unresolvable** — `BITNR`, `MBLR`, `RBT`, `CCCX`, `SIVE`, `USARE`
  (typos / OTC / pre-IPO / renamed / hallucinated).

Affected data, by kind:

- **15 committed-but-empty** `data/prices/<symbol>.json` files (`BTCUSD`,
  `ETHUSD`, `$ETH.X`, `BTC.X`, `BTCUSDT`, `ETH.X`, `SI1!`, `SPCFD`, `BITNR`,
  `MBLR`, `RBT`, `CCCX`, `HEIA`, `SIVE`, `USARE`).
- **2 committed-but-wrong** `data/prices/{BTC,ETH}.json` (Grayscale ETF data).
- ~31 affected calls in `TheProfInvestor` (of 897): ~23 crypto (incl. bare
  BTC/ETH), 1 `HEIA` recovered to `HEIA.AS`, ~7 dropped as dead (`SI1!`,
  `SPCFD`, `BITNR`, `MBLR`, `RBT`, `SIVE`, `USARE`). Plus 1 in `kevvonz`
  (`CCCX`, of 21).

Three failure modes:

| Mode        | Trigger                                                                                                                  | Symptom                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Hard error  | Yahoo _throws_ "No data found" → loader `ensureQueryData` rejects (`c.$handle.ticker.$symbol.tsx:51`) → whole route dies | `Something went wrong` page                                            |
| Soft empty  | Yahoo _returns_ `[]` (no throw) + baked file empty                                                                       | Blank chart with "PRICE" label + dashed grid                           |
| Wrong asset | bare `BTC`/`ETH` resolves to the Grayscale ETF                                                                           | Chart + scored returns against the wrong instrument (no visible error) |

Note: the _current_ `pipeline/prices.ts:76` and `pipeline/score.ts:64` already
skip writing empty files. The empty + wrong files are **legacy commits**
(tracked at HEAD, not regenerated). They persist because `score` only appends to
the shared store; it never deletes a stale or now-non-canonical file.

## Decisions (locked during brainstorming)

1. **Multi-asset scope, Yahoo as the single price source.** Crypto is scored vs
   SPY by normalizing to Yahoo's `-USD` pairs. No new crypto API — adding one
   would re-fork the very symbol→price seam this design unifies (a second fetch
   path, data shape, cache, and rate-limit handler in two files). Yahoo serves
   `BTC-USD` / `ETH-USD` daily + intraday OHLC with the same shape the equity
   path already consumes.
2. **Unpriceable calls are excluded + logged**, not flagged in the schema/UI.
   No `Call` schema change, no UI change, no dead ticker pages. The raw calls
   remain in `reel-calls.json` (auditable); only the scored `dataset.json`
   drops them.

Accepted caveat: "excess vs SPY" now mixes a 24/7 asset (crypto) against a
5-day benchmark. Mechanically fine — the date-join already nulls unmatched SPY
days — but it is apples-to-oranges in the headline metric, so it is disclosed
in `caveats`.

## Architecture

One resolver seam + one gate. No new abstractions beyond the resolver.

### 1. `src/lib/symbol.ts` — `resolveSymbol(raw): string | null`

Pure, dependency-free, unit-tested. The single place a raw ticker becomes a
canonical Yahoo symbol. Returns `null` for "not a resolvable / in-scope symbol".

Rules, applied in order:

1. Trim; strip a leading `$`.
2. **Crypto map** — an **explicit, enumerated set** of crypto bases (currently
   exactly `{BTC, ETH}` — the bases present in the data; extended by hand as new
   ones appear). A raw symbol matches if it equals `<BASE>`, `<BASE>USD`,
   `<BASE>USDT`, or `<BASE>.X` for a base in the set → maps to `<BASE>-USD`. This
   collapses `BTC` / `BTCUSD` / `BTCUSDT` / `BTC.X` → `BTC-USD`.
   **Do NOT pattern-match** (e.g. `/^[A-Z]{3}$/` or `/USD$/`) — that would
   capture hundreds of real equities. The set is a reviewed allow-list.
3. **Override map** — genuine equities in the wrong notation: `HEIA → HEIA.AS`.
   Extensible: the map grows as real mappings are identified for currently-dead
   tickers.
4. **Reject** out-of-scope notations → `null`: continuous-futures suffix
   (`/!$/`, e.g. `SI1!`) and known CFD codes (e.g. `SPCFD`).
5. **Passthrough** — anything else returned unchanged (normal equities, and
   unknowns like `BITNR` that the _gate_ will catch).

**Stated assumption (crypto-wins override).** `BTC` and `ETH` are _also_ real US
equity tickers (the Grayscale Mini Trust ETFs that the current data wrongly
scores against). Mapping bare `BTC`/`ETH` → spot `BTC-USD`/`ETH-USD`
**deliberately overrides** those equities, because in this product a creator
saying "$BTC" means Bitcoin. This is a product decision, not an accident; it is
why the base set must stay small and explicitly reviewed.

Design note: the resolver only encodes mappings we are confident about. It does
not try to validate arbitrary tickers — the priceability gate (does Yahoo
return bars?) is the catch-all. This keeps `symbol.ts` small and deterministic.

### 2. Priceability gate at `score` (single source of truth)

`assembleDataset` (in `pipeline/score.ts`) resolves each bullish call's ticker
and scores it **only if** the resolved symbol has price bars. A call is
**excluded from the dataset and logged** (`UNPRICEABLE <raw> (<reason>)`) when:

- `resolveSymbol(raw)` returns `null` (out-of-scope / rejected), or
- the resolved symbol has zero price bars in the OHLC map.

Scored calls carry the **canonical** ticker (`ticker: BTC-USD`), so fragmented
BTC/ETH calls merge onto one ticker page, the proof embed and sparkline use the
canonical symbol, and `company` (e.g. "Bitcoin") is unchanged.

Consequence: no empty price files are ever produced, and no `Call` in
`dataset.json` points at an unpriceable symbol — so the ticker page can never
hit the empty/crash state from bad data.

### 3. The three call sites adopt the resolver (the unified seam)

- **`pipeline/prices.ts`** — resolve each ticker to canonical, **dedupe by
  canonical** (one `BTC-USD` fetch, not three), fetch + write the price file
  keyed by canonical. Skip `null`.
- **`pipeline/score.ts`** — resolve each call's ticker, emit canonical, apply
  the gate (above). The shared cross-creator store is already keyed off
  `ds.calls`, so it inherits canonical keys.
- **`src/lib/chart-fetch.ts` + the ticker route loader** — defensive resolve
  (URLs are already canonical once datasets are regenerated, but resolving is
  cheap, keeps the seam honest, and rescues stale external links to the old raw
  symbol) **and** make the loader resilient.

  The crash vector is **SSR-only**: the loader's
  `context.queryClient.ensureQueryData(chartQuery(...))`
  (`c.$handle.ticker.$symbol.tsx:51`) awaits the live fetch, and an awaited
  rejection in a TanStack loader propagates to the route `errorComponent`. The
  client `useQuery` already degrades via `query.isError` (`:114`). The fix is
  therefore narrow: wrap the prefetch so a rejection becomes a no-op
  (`.catch(() => undefined)`), letting the component fall through to its
  existing `usingFallback` branch. The catch belongs on **that** call, _not_ on
  `fetchPrices` — `fetchPrices` already returns `[]` (never throws) when prices
  are missing (`src/lib/data.ts:90,96`), so the baked-empty case is already
  handled.

### 4. Display empty state (defense-in-depth)

When `candles.length === 0` after both live and baked paths, the ticker route
renders an explicit "No price data for this symbol" message in the chart card
instead of a bare grid. With the data fix in place this should rarely trigger,
but it is the correct terminal state for a genuinely dataless symbol (and for
transient live failures with no baked fallback).

Known minor quirk (accepted, documented as a caveat): for a 24/7 `-USD` crypto
symbol viewed on a weekend, the **1D** timeframe window
(`chart-window.ts` `lastTradingDay` rewinds Sat/Sun to Friday) shows a stale
Friday-onward window rather than the last 24h. Not a crash; out of scope to
special-case here.

### 5. One-time migration (no LLM, no re-extract)

**Static store:**

1. Delete **every** `data/prices/<raw>.json` whose name is non-canonical —
   i.e. `<raw> !== resolveSymbol(<raw>)`. This covers both the 15 empty files
   _and_ the 2 wrong-asset files (`BTC.json`, `ETH.json`), and is the general
   rule (don't enumerate by emptiness). Deletes tolerate already-missing files
   (idempotent re-run).
2. Also clean the stale per-creator `data/creators/<h>/prices/<raw>.json` files
   keyed by now-non-canonical symbols (gitignored, but `score` reads this dir —
   `score.ts:47-48` — so leaving raw-keyed files there is confusing even though
   `score`'s shared-store loop keys off canonical `ds.calls` and ignores them).
3. Re-run `prices` → `score` for `TheProfInvestor` and `kevvonz` with the new
   resolver. Recovers ~23 crypto calls (merged onto `BTC-USD` / `ETH-USD`,
   including the previously-wrong bare `BTC`/`ETH`), drops the ~9 genuinely-dead
   calls (logged), applies `HEIA.AS`.

**DB reconciliation (owner-role; only if the DB has already been backfilled
with pre-fix data).** The `prices` store is insert-only and `calls` upserts via
`onConflictDoNothing`/`onConflictDoUpdate` — **neither ever deletes**
(`db/backfill.ts:44,88`). So after re-score the DB retains orphan rows that the
static store no longer has:

- **Orphan `calls` rows** (the ~9 dropped + the renamed `BTCUSD`→`BTC-USD`
  shortcodes if PK includes ticker — verify PK is `(handle, shortcode)`, so a
  ticker change is an _update_, not an orphan; only truly-dropped calls orphan).
  `scripts/parity-check.ts:52` reassembles the dataset from the DB and asserts
  `static == db` — with orphan call rows the DB dataset has more calls than
  static, so **dataset parity FAILS**. (The earlier review's claim that
  `db:sync`/`backfill` _throws_ on a row-count mismatch is incorrect — backfill
  upserts silently; the failure surfaces here, at parity-check.)
- **Orphan `prices` symbols** (`BTC`, `ETH`, `BTCUSD`, …). `parity-check.ts:58`
  only iterates _static_ price files, so orphan DB symbols are **invisible** to
  it — parity can pass while they linger. They must still be deleted for
  correctness.

Reconciliation is a privileged op the `ingest` role cannot do (INSERT-only on
prices, no DELETE on calls). As the **DB owner**:

```sql
DELETE FROM calls  WHERE handle = :h AND shortcode IN (:dropped_shortcodes);
DELETE FROM prices WHERE symbol IN ('BTC','ETH','BTCUSD','BTCUSDT','BTC.X',
                                    'ETH.X','$ETH.X','ETHUSD','SI1!','SPCFD',
                                    'BITNR','MBLR','RBT','CCCX','SIVE','USARE',
                                    'HEIA');
```

Then `db:sync` (re-backfill + re-materialize) and `scripts/parity-check.ts` →
must print `PARITY OK`. If the DB has **not** yet been backfilled (USE_DB still
0, the current prod state), skip this block — a fresh backfill from the
corrected static store is already clean.

**Commit:** the regenerated `dataset.json` files, the new/merged
`data/prices/*.json` (incl. `BTC-USD.json`, `ETH-USD.json`, `HEIA.AS.json`), and
the deletions.

`reel-calls.json` is left untouched (raw tickers stay auditable; resolution is
applied downstream at `prices`/`score`).

### Why the rename does not trip `detectBasisShift`

Canonicalization changes the file **key** (`BTCUSD`→`BTC-USD`,
`BTC`→`BTC-USD`), so the new canonical file starts from `existing = []`.
`mergePrices`/`detectBasisShift` (`src/lib/prices-merge.ts`) only fire on
_overlapping_ dates within the _same_ symbol, so a rename writes fresh bars with
no basis comparison. The insert-only/frozen guarantee is unaffected — no scored
bar is rewritten, the old symbol's file is simply deleted and a new one created.

## Component boundaries

| Unit                            | Does                                                 | Used by                                           | Depends on          |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------- | ------------------- |
| `src/lib/symbol.ts`             | raw ticker → canonical Yahoo symbol or `null`        | prices.ts, score.ts, chart-fetch.ts, route loader | nothing (pure)      |
| gate in `assembleDataset`       | exclude + log unpriceable calls; emit canonical      | score.ts                                          | symbol.ts, OHLC map |
| loader resilience + empty state | never crash on live-Yahoo error; show explicit empty | ticker route                                      | —                   |

## Testing

- **`src/lib/symbol.test.ts`** — table-driven: `BTC` / `BTCUSD` / `BTCUSDT` /
  `BTC.X` / `$ETH.X` collapse to `<BASE>-USD`; bare `BTC`/`ETH` map to the
  `-USD` pair (crypto-wins override, not the Grayscale equity); `HEIA →
HEIA.AS`; `SI1!` / `SPCFD` → `null`; normal equities pass through unchanged;
  idempotent (`resolve(resolve(x)) === resolve(x)`); a non-crypto 3-letter
  ticker (e.g. `IBM`, `MMM`) is NOT mistaken for crypto (guards against
  pattern-matching regression).
- **Gate** — `assembleDataset` excludes a call whose ticker resolves to `null`
  and one whose resolved symbol has no bars; canonical ticker emitted for a
  crypto call; existing scoring unaffected for normal equities.
- **Migration verification** — after re-score: **no** `data/prices/<raw>.json`
  exists where `raw !== resolveSymbol(raw)` (catches empty _and_ wrong-asset
  files); `BTC-USD` / `ETH-USD` / `HEIA.AS` price files exist and are non-empty
  with sane magnitudes (BTC-USD ≫ $1000, not ~$48); the dead tickers no longer
  appear in either `dataset.json`; bare `BTC`/`ETH` calls now carry canonical
  tickers; `parity-check` prints `PARITY OK`.
- **DB reconciliation (the highest-risk, previously-untested area)** — if a DB
  is present: after the owner-role DELETEs + `db:sync`, assert (a) the DB
  `prices.symbol` set contains **no** non-canonical symbol (the orphan-price
  case parity-check cannot see); (b) the DB `calls` count per creator equals
  `dataset.json` calls length (no orphan dropped-call rows); (c) `parity-check`
  prints `PARITY OK`. Env-gated like the existing `db/*.test.ts`.
- **Display** — manual: `/c/TheProfInvestor/ticker/BTC-USD` shows a real chart
  (crypto magnitudes); a stale `/ticker/BTCUSD` URL resolves to `BTC-USD` (or
  renders the empty state) rather than crashing the route.

## Out of scope

- No `Call` schema change, no UI flag for unpriceable calls.
- No crypto-native price API.
- No re-extraction / no LLM calls.
- No backfill of mappings for the currently-dead tickers beyond `HEIA` — the
  override map is the seam for adding them later when a real mapping is known.
