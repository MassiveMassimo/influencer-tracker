# Ticker-primary page + creator switcher — design

Date: 2026-06-18
Branch: `ticker-primary`

## Problem

The ticker page is modelled as a child of a creator (`/c/$handle/ticker/$symbol`):
the stock is something a creator called. We want to invert the mental model — the
**stock ticker is top-level**, and a creator is a *selection* within it (default:
all creators who called the stock). A viewer lands on a stock, sees its price and
the whole roster who called it, and can filter to one creator.

## Architecture (decided: Option A)

One **ticker-primary route** with the selected creator carried as a `?creator=`
**search param**. No param = "All".

- **Host route: `/t/$symbol`** — already the ticker-primary, cross-creator page.
  Promote it to the full page: add the price charts + the creator-switcher tabs +
  the per-creator calls detail. `?creator=<handle>` selects a creator.
- **`/c/$handle/ticker/$symbol` becomes a redirect** → `/t/$symbol?creator=<handle>`
  (`beforeLoad` throws a `redirect`). Keeps every inbound link, bookmark, and the
  `/t` byCreator list working. The list rows switch to linking `/t/$symbol?creator=`
  directly (no redirect hop).
- **Why a search param, not a path segment:** changing a search param keeps the
  route component **mounted**, so the tab-indicator morph and the chart marker
  restagger animate continuously across creator switches. A path-param/route swap
  remounts and kills that continuity. It is also the faithful expression of
  "ticker is top-level, creator is a selection."

### Loader

`/t/$symbol` loader (`validateSearch` parses `{ creator?: string }`):

- **Always:**
  - `fetchCallsIndex()` → `summarizeTicker(calls, symbol)` (cross-creator summary;
    404 via `notFound()` when `callCount === 0`, unchanged).
  - `listCreators()` → project to names + avatars for shown handles (unchanged).
  - Price prefetch: `chartQuery(symbol, "1Y", firstDate)` (best-effort, degrade to
    baked), `fetchPrices(symbol)`, `fetchPrices("SPY")` — moved here from the old
    `/c/...` loader. `firstDate` = earliest call date across the index hits.
  - `prefetchHalal([symbol])` (unchanged).
- **If `search.creator` is set:** also `fetchDataset(creator)` for that creator's
  detailed calls (1w/1m/3m/toDate + quote + shortcode), used by the detail table and
  that creator's chart markers. Skipped in All mode.

The loader depends on the search param (`loaderDeps: ({ search }) => ({ creator: search.creator })`)
so switching creators re-runs only the dataset fetch; price/index/halal are cached.

### OG / head

`head({ params, loaderData, search })`: when `search.creator` is set, point
`og:image` at the prebuilt creator-ticker card `/api/og/t/<creator>/<symbol>/<rev>`
(existing path, byte-identical to today). In All mode use the cross-creator OG
(`/og.png` today, unchanged). Title mirrors: `NOW — <name> · Signal Tracker` vs
`NOW — who called it · Signal Tracker`.

## Page layout (`/t/$symbol`)

1. **Header.** `TICKER` eyebrow, `<symbol>` + `HalalIndicator` + company name.
   To the right, `items-end`: the **CreatorSwitcher** (section below). Hidden when
   `summary.creatorCount === 1` (nobody to switch to).

2. **Price candlestick** + **Stock vs SPY** charts. Price series is
   creator-agnostic (symbol-keyed). **Markers**:
   - All mode → every creator's call dates for the symbol (from the index hits).
   - Creator selected → that creator's calls only (from the fetched dataset).
   Reuses `PriceCandles` / `StockVsSpyLine` / `buildChartView` / `chartQuery`
   unchanged; only the marker source switches.

3. **"Who called it & when"** (always shown, both modes):
   - **Table** — the existing `/t` byCreator list: avatar · name · first-call date ·
     # calls · excess 3m · excess→now. Sort unchanged (by ex3m). Each row links to
     `/t/$symbol?creator=<handle>` (selects that creator in place).
   - **Timeline swimlane** directly below, **rows aligned to the table's order**.
     See component spec.

4. **Calls detail table** — 1w/1m/3m/toDate + quote, tap-for-proof (the current
   `/c/...` table). Rendered **only when a creator is selected**; hidden in All mode.
   `ProofViewer` wired as today.

## Components

### CreatorSwitcher (`src/components/ticker/creator-switcher.tsx`)

A tab strip, right-aligned (`items-end`), no name text on triggers.

Tabs, left→right:
- **`All`** — default/active when no `?creator=`. Label: short text "All" or a
  stacked-avatars glyph (pick "All" text for clarity; YAGNI on the glyph).
- **Up to 3 avatar tabs** — order: **selected creator first** (when one is selected
  and it is a caller), then the most-recent *other* callers by `lastCallDate`, capped
  at 3 total avatars. Each trigger = avatar only; **cossui `Tooltip`** shows the name
  on hover/focus. Selecting → navigate `to="/t/$symbol" search={{ creator: handle }}`.
- **🔍 search tab** — lucide `Search` icon. On press it **morphs into a combobox
  input**: the active tab indicator expands to fill the whole tab container and
  becomes the combobox background (transitions-dev "sliding tabs" + "search/input
  reveal" patterns — animate the indicator's width/position, cross-fade icon→input).
  Combobox lists **all** callers; each row: avatar · name · last-call date ·
  call count. Selecting a row → same navigation. Escape / blur / outside-click
  collapses back to the icon tab.

Active state: derived from `?creator=` (All when absent). The morph/indicator uses
`layoutId`-style shared-element animation (motion is already a dep via charts) or the
transitions-dev CSS approach — implementer picks the simplest that achieves
"indicator becomes the combobox background."

Data prop: `creators: { handle, name, avatar, lastCallDate, callCount }[]` +
`selected: string | null`.

### TickerCallTimeline (`src/components/ticker/call-timeline.tsx`)

Simple custom SVG swimlane — **no new dependency**, no bklit chart shell (bklit ships
no timeline primitive). Reuses the crosshair/tooltip *styling* from
`charts/tooltip/`.

- **Axis:** shared horizontal date range = [earliest call across all shown creators,
  today]. A few date ticks (start, mid, today) along the bottom.
- **Rows:** one per creator, **same order as the table above** (so a viewer can read
  across). Row height ~28px. Left gutter shows a tiny avatar (or nothing — table
  already labels; keep avatar for at-a-glance alignment).
- **Dots:** one per call at `x = (postDate − min) / (max − min)`. First-call dot is
  ringed/filled; later calls hollow. Dot color toned by that call's excess (reuse
  `tone()`), or neutral — keep neutral for simplicity.
- **Hover crosshair:** a vertical line spanning all rows that follows the pointer,
  with a floating date label at the top edge — lets you line up "who called first"
  and compare timing across rows. Pointer-driven, no per-dot tooltip needed (keep
  simple); optionally a dot tooltip later (YAGNI now).
- Pure presentational: `props = { creators: { handle, name, avatar, calls: { postDate, isFirstCall }[] }[], rangeStart, rangeEnd }`.

## Lib changes

- `src/lib/call-filter.ts`: add `lastCallDate: string | null` to `TickerCreatorRow`
  (max `postDate` across that creator's hits) — feeds the combobox "date of last
  call". Timeline call-dates come straight from the filtered `CallIndexEntry[]`
  (already has `handle` + `postDate` + `isFirstCall`); no index schema change.
- The "recent callers" ordering for the avatar tabs uses `lastCallDate` desc.

## Routing details

- `/c/$handle/ticker/$symbol`: replace component with
  `beforeLoad: ({ params }) => { throw redirect({ to: "/t/$symbol", params: { symbol: params.symbol }, search: { creator: params.handle } }) }`.
  Delete the now-dead chart/table body (moved to `/t/$symbol`).
- `/t/$symbol`: add `validateSearch`, `loaderDeps`, the expanded loader, and the new
  component tree.

## Error handling / fallbacks (unchanged semantics)

- Live-Yahoo prefetch failure → baked OHLC fallback (existing `.catch` + `buildChartView`).
- `fetchDataset(creator)` failure in a selected-creator view → degrade to All mode
  (log + drop the detail table + creator markers), never crash the route.
- Halal fail-open (existing).
- `summary.callCount === 0` → `notFound()` (existing).

## Testing

- `call-filter.test.ts` (if present) / new: `summarizeTicker` now emits `lastCallDate`
  (max postDate per creator); assert on a multi-call fixture.
- Component: `CreatorSwitcher` renders All + ≤3 avatars + search; selecting sets the
  expected `search.creator`; hidden when one creator. `TickerCallTimeline` positions
  dots at expected x% for a known range (pure math, snapshot-free assertion).
- Manual/visual (on `main` after merge per project workflow): morph animation,
  crosshair, marker swap between All and a creator. Note the IO/`useInView` automation
  artifact does not apply here (no reveal-gated values in this tree).

## Out of scope (YAGNI)

- Per-dot tooltips on the timeline (crosshair + date label is enough).
- Multi-creator marker color-coding on the price chart (All mode shows undistinguished
  dots; revisit only if it reads as noise).
- Stacked-avatar glyph for the "All" tab (plain "All" text).
- Animating the All↔creator chart-marker set beyond the existing restagger.
