# Influencer-Tracker — Accuracy UI Redesign

**Date:** 2026-06-03
**Status:** Design — pending user review
**Companion audit:** `influencer-tracker/docs/ui-audit.md`

## Problem

The app's purpose is to find _which finfluencers are most accurate at stock calls_.
Today it can't: there is no cross-creator ranking, the per-creator accuracy numbers are
presented without sample size (and three different "beats SPY" figures contradict each
other on one page), and the charts have UX gaps — a single fixed time window, and call
markers that render but are painted transparent so they're invisible.

This spec covers the changes to make the dashboard answer its own question honestly, plus
the chart UX the user asked for (timeframe tabs, working call markers with tooltips,
per-row sparklines).

## Goals

1. Rank creators by a single, defensible accuracy metric — with sample size visible and
   small samples flagged and de-ranked.
2. Make every accuracy number on the creator page trustworthy: show its denominator,
   reconcile the conflicting win-rate figures, fix the misleading funnel.
3. Fix and upgrade the price charts: working call markers with hover detail, calendar
   timeframe tabs, and at-a-glance per-call sparklines.

## Non-goals (flagged in the audit, deliberately NOT done here)

- No methodology change to scoring: keep first-call-per-ticker as the scored unit, keep
  excess = raw `stock − SPY` (no beta/factor adjustment). These are decisions, not bugs;
  changing them re-bases every number and is out of scope.
- No beta-adjusted "alpha", no "all calls" secondary win rate.
- The `best/worst` median-split in `scorecard.ts:41-42` is left alone (unused by the UI).

## Decisions (resolved with user)

| Decision                  | Choice                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical accuracy metric | **3m hit rate on first calls** = % of first-call-per-ticker beating SPY at 3m, shown with its `n`. Sign-based, least gameable by high-beta picks. |
| Small samples             | **Show + flag + sort last**: `n < 10` rendered "low confidence", ranked below proven creators regardless of %.                                    |
| Change scope              | **Presentation + add sample-count fields**; no methodology change.                                                                                |
| Timeframe tabs            | **Ticker price charts only** (1M / 3M / 6M / 1Y / All), animated.                                                                                 |
| Sparkline                 | **Stock path + call marker**, native SVG, colored by to-date excess.                                                                              |
| Call markers              | **Vendor bklit `ChartMarkers`** (proper annotations + tooltip), no stopgap.                                                                       |

`LOW_CONFIDENCE_N = 10` (single shared constant).

---

## Workstreams

### A. Data layer — expose sample sizes (no methodology change)

**`src/lib/types.ts`** — extend `Scorecard`:

```ts
hitRateN: { "1m": number; "3m": number };  // denominators behind hitRate
```

**`src/lib/scorecard.ts`** — `buildScorecard` already computes the `elapsed` arrays per
horizon; capture their `.length` into `hitRateN`. No change to how `hitRate`/`avgExcess`
are computed.

**`pipeline/score.ts`** — `updateIndex` entry gains the fields the leaderboard needs:

```ts
{ handle, name, avatar?,
  totalCalls, firstCalls,            // firstCalls = scorecard.uniqueTickers
  hitRate3m, hitRate3mN,             // from scorecard
  avgExcess3m, generatedAt }
```

**`src/lib/data.ts`** — widen the `listCreators` return type to match.

**Regenerate** `kevvonz` so `dataset.json` + `index.json` carry the new fields. The score
stage is a pure function of `reel-calls.json` + `prices/`; re-run it (small script or the
pipeline's score entry) — no re-scrape, no re-extract.

**Tests** (`src/lib/scorecard.test.ts`): assert `hitRateN` equals the count of first calls
with elapsed excess at each horizon, including the all-pending → `n=0` case.

### B. Leaderboard — `src/routes/index.tsx`

Replace the unsorted list with a sortable table.

- **Columns:** rank · creator (avatar + name + @handle) · **hit rate 3m** (`57% · 4/7`,
  low-confidence badge when `n < 10`) · avg excess 3m · total calls · updated (relative).
- **Default sort:** hit-rate 3m desc, **low-confidence creators always grouped last**
  (proven creators first, regardless of a lucky small-sample %).
- **Re-sort:** clickable column headers (client-side; data is already in the loader). One
  `useState` for `{key, dir}`; a comparator that respects the low-confidence partition.
- **Avatar:** render the `avatar` data-URI from `index.json` (fixes the ignored-avatar
  bug); fall back to initials.
- **Degrade to 1 creator:** render the single row without "#1 of 1" emphasis; the table is
  the same component, just one row.
- **Zero handling:** `avgExcess3m === 0` is neutral, not green (`> 0`, not `>= 0`).

### C. Creator-page trust fixes

**`c.$handle.index.tsx` + `AnalyticsCharts.tsx` + `Scorecard.tsx`:**

- Hit-rate gauge and the hit-rate tile show `n` and the fraction ("4 of 7 first calls ·
  3m"); a "low confidence" note appears when `n < LOW_CONFIDENCE_N`. Kills the bare "57%".
- **Funnel → 5 honest stages** (`pipeline/score.ts`), each a true subset of the one above,
  so the narrowing is real instead of a denominator switch:
  `Reels 157 → Named a stock 27 → Bullish buy call 13 → First call (unique ticker) 10 → Beat SPY to-date 4`.
  Update `scorecard.test.ts` funnel assertions.
- Caption "vs SPY · not risk-adjusted" near excess metrics (labeling only).
- **Staleness:** if `generatedAt` is > 30 days before today, show "data N days old"
  prominently next to the existing "as of" date.
- Calls-list `first` badge gets a tooltip explaining it's the only scored call per ticker.

### D. Chart fix — working call markers + tooltips (vendor from bklit)

Source: `https://github.com/bklit/bklit-ui`. Vendor the marker components that are absent
from the local subset, matching the existing copy-in style under
`src/components/charts/`:

- `ChartMarkers` (props: `items`, `size`, `showLines`, `animate`)
- `MarkerTooltipContent`, `useActiveMarkers`
- their `ChartMarker` type
- plus any small internal deps they import (resolve while vendoring).

**Replace the transparent-line hack** on the ticker page. Today:
`<Line dataKey="call" showMarkers stroke="transparent" />` renders markers with a
transparent fill (`line.tsx:161-162` defaults marker fill/stroke to the line's stroke).
Confirmed invisible in the running app.

New: build `callMarkers: ChartMarker[]` from `calls` (date = `postDate`, title = ticker +
date, description = truncated quote + to-date excess, optional icon). Render
`<ChartMarkers items={callMarkers} />` + a `<ChartTooltip>` that surfaces the active
marker via `useActiveMarkers`/`MarkerTooltipContent`. Use on **both** the candlestick and
the stock-vs-SPY line chart (candlestick uses the same composition per bklit docs).

_Risk / fallback:_ if a vendored component pulls in deps that don't fit the local shell,
fall back to a thin local `CallMarkers` overlay that consumes `xScale` from chart context
and renders a tick + tooltip per call date. Decide while vendoring, not assumed.

### E. Timeframe tabs — ticker price charts

**New `src/components/TimeframeTabs.tsx`** — the Transitions.dev sliding-pill tab control
the user supplied, adapted:

- Structure/motion preserved: `role="tablist"`, pill driven by the active tab's
  `offsetLeft`/`offsetWidth`, snaps without transition on first paint + resize (suspend
  transition → force reflow → restore), honors `prefers-reduced-motion`.
- **Theme adaptation:** the supplied CSS hardcodes light-mode hex
  (`--tabs-bar-bg:#eeeeee`, `--tabs-pill-bg:#fff`, text `#0f0f0f`). Remap these four vars
  to the app's design tokens (`--muted`, `--background`, `--foreground`/`--muted-foreground`)
  so the pill works in dark mode. Same animation, themed colors. CSS lives in the project's
  global stylesheet; component uses the `t-*` class names.
- Tabs: **1M · 3M · 6M · 1Y · All**.

**`c.$handle.ticker.$symbol.tsx`:**

- `useState` `timeframe` (default "All" or "1Y" — pick "1Y" so the default view is focused).
- Extract a pure `windowSeries(ohlc, timeframe, asOf)` helper (own file + unit test): keeps
  bars with `date >= asOf − window`; "All" returns all. `asOf` = last bar date.
- Filter both `candles` and the rebased `norm` to the window. **Rebase the vs-SPY lines to
  the first in-window bar** so both start at 100 within the zoom.
- Pass `revealSignature={timeframe}` to both charts → the built-in clip-reveal replays =
  the animated data shift. Y-axis auto-rescales to the window.

### F. Per-call sparklines — overview calls table

**New `src/components/Sparkline.tsx`** — native SVG, no bklit dep (cheap for many rows):

- Input: `ohlc` bars from the call's `postDate` forward, plus the call's to-date excess
  sign for color.
- Render: polyline of closes, a dot at the first point (call date). Stroke + dot colored
  green/red by excess sign, neutral when flat/pending. ~64×20px, `aria-hidden` with an
  adjacent sr-only label.

**`c.$handle.index.tsx` `CallRow`:** add a sparkline cell before the return figure, fed by
`ds.tickers[call.ticker].ohlc` sliced from `postDate`.

---

## Testing & verification

- `bun test` green — new/updated cases: `hitRateN`, 5-stage funnel, `windowSeries`.
- `bunx tsc --noEmit` clean (widened `Scorecard`, `index.json` entry, `listCreators`).
- Manual (run app, the user already has `:3000`): leaderboard sorts + flags low-confidence;
  creator page shows `n` everywhere and the 5-stage funnel; ticker page shows **visible**
  call markers with hover tooltips, timeframe tabs animate the window; table rows show
  sparklines. Re-screenshot the VOO line chart to confirm markers are now visible (the
  regression we proved today).

## Rollout / sequencing

1. **A** data layer + regenerate (unblocks B, C-funnel).
2. **D** marker fix (smallest, highest-visibility; the verified regression).
3. **B** leaderboard.
4. **C** trust fixes (n, funnel, staleness, labels).
5. **E** timeframe tabs.
6. **F** sparklines.

Each step is independently shippable and verifiable.
