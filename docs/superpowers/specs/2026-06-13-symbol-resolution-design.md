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
- **Foreign listing missing its suffix** — `HEIA` (Heineken, Amsterdam) is
  `HEIA.AS` on Yahoo.
- **Out-of-scope notations** — TradingView futures `SI1!`, CFD `SPCFD`.
- **Genuinely unresolvable** — `BITNR`, `MBLR`, `RBT`, `CCCX`, `SIVE`, `USARE`
  (typos / OTC / pre-IPO / renamed / hallucinated).

These produced 15 committed-but-empty `data/prices/<symbol>.json` files and ~27
affected calls in `TheProfInvestor` (of 897) plus 1 in `kevvonz` (of 21).

Two distinct failure modes depending on whether Yahoo throws or returns empty:

| Mode | Trigger | Symptom |
|---|---|---|
| Hard error | Yahoo *throws* "No data found" → loader `ensureQueryData` rejects (`c.$handle.ticker.$symbol.tsx:51`) → whole route dies | `Something went wrong` page |
| Soft empty | Yahoo *returns* `[]` (no throw) + baked file empty | Blank chart with "PRICE" label + dashed grid |

Note: the *current* `pipeline/prices.ts:76` and `pipeline/score.ts:64` already
skip writing empty files. The 15 empty files are **legacy commits** (tracked at
HEAD, not regenerated). They persist because `score` only appends; it never
deletes a stale empty file.

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
2. **Crypto map** — a small data-driven set of bases (`BTC`, `ETH`, `SOL`, …)
   combined with the notations we have seen (`<BASE>USD`, `<BASE>USDT`,
   `<BASE>.X`, bare `<BASE>` when in the crypto set) → `<BASE>-USD`. This
   collapses `BTCUSD` / `BTCUSDT` / `BTC.X` → `BTC-USD`.
3. **Override map** — genuine equities in the wrong notation: `HEIA → HEIA.AS`.
   Extensible: the map grows as real mappings are identified for currently-dead
   tickers.
4. **Reject** out-of-scope notations → `null`: continuous-futures suffix
   (`/!$/`, e.g. `SI1!`) and known CFD codes (e.g. `SPCFD`).
5. **Passthrough** — anything else returned unchanged (normal equities, and
   unknowns like `BITNR` that the *gate* will catch).

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
  cheap and keeps the seam honest) **and** make the loader resilient: a Yahoo
  throw must degrade to the baked fallback, not reject `ensureQueryData` and
  crash the whole route. This is defense-in-depth against transient live-Yahoo
  failures, independent of the data fix.

### 4. Display empty state (defense-in-depth)

When `candles.length === 0` after both live and baked paths, the ticker route
renders an explicit "No price data for this symbol" message in the chart card
instead of a bare grid. With the data fix in place this should rarely trigger,
but it is the correct terminal state for a genuinely dataless symbol (and for
transient live failures with no baked fallback).

### 5. One-time migration (no LLM, no re-extract)

1. Delete the 15 committed empty `data/prices/<symbol>.json` files.
2. Re-run `prices` → `score` for `TheProfInvestor` and `kevvonz` with the new
   resolver. This recovers ~18 crypto calls (merged onto `BTC-USD` / `ETH-USD`),
   drops the ~9 genuinely-dead calls (logged), and applies `HEIA.AS`.
3. Re-sync the DB (`db:sync`) and run `scripts/parity-check.ts` → must print
   `PARITY OK`.
4. Commit the regenerated `dataset.json` files, the new/merged
   `data/prices/*.json`, and the deletion of the empty files.

`reel-calls.json` is left untouched (raw tickers stay auditable; resolution is
applied downstream at `prices`/`score`).

## Component boundaries

| Unit | Does | Used by | Depends on |
|---|---|---|---|
| `src/lib/symbol.ts` | raw ticker → canonical Yahoo symbol or `null` | prices.ts, score.ts, chart-fetch.ts, route loader | nothing (pure) |
| gate in `assembleDataset` | exclude + log unpriceable calls; emit canonical | score.ts | symbol.ts, OHLC map |
| loader resilience + empty state | never crash on live-Yahoo error; show explicit empty | ticker route | — |

## Testing

- **`src/lib/symbol.test.ts`** — table-driven: crypto notations collapse to
  `<BASE>-USD`; `$` stripped; `HEIA → HEIA.AS`; `SI1!` / `SPCFD` → `null`;
  normal equities pass through unchanged; idempotent (`resolve(resolve(x)) ===
  resolve(x)`).
- **Gate** — `assembleDataset` excludes a call whose ticker resolves to `null`
  and one whose resolved symbol has no bars; canonical ticker emitted for a
  crypto call; existing scoring unaffected for normal equities.
- **Migration verification** — after re-score: zero empty `data/prices/*.json`;
  `BTC-USD` / `ETH-USD` price files exist and are non-empty; the dead tickers no
  longer appear in either `dataset.json`; `parity-check` prints `PARITY OK`.
- **Display** — manual: `/c/TheProfInvestor/ticker/BTC-USD` shows a chart;
  visiting a removed symbol 404s/redirects rather than rendering a blank chart.

## Out of scope

- No `Call` schema change, no UI flag for unpriceable calls.
- No crypto-native price API.
- No re-extraction / no LLM calls.
- No backfill of mappings for the currently-dead tickers beyond `HEIA` — the
  override map is the seam for adding them later when a real mapping is known.
