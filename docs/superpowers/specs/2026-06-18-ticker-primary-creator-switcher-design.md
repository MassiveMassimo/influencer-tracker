# Ticker-primary page + creator switcher — design

Date: 2026-06-18
Branch: `ticker-primary`

## Problem

The ticker page is modelled as a child of a creator (`/c/$handle/ticker/$symbol`):
the stock is something a creator called. We want to invert the mental model — the
**stock ticker is top-level**, and a creator is a *selection* within it (default:
all creators who called the stock). A viewer lands on a stock, sees its price and
the whole roster who called it, and can filter to one creator.

## Architecture (decided: single route, creator as PATH param)

> **Supersedes the original Option A (`?creator=` search param).** The opus spec
> review found a search param collides with path-based ISR caching (`vite.config.ts`
> caches `/t/**` for 6h, query strings stripped from the cache key → all `?creator=`
> variants collide on one entry) and with OG scrapers (Slack/Twitter/Discord strip
> query strings → a shared creator link renders the All card). A **path param** fixes
> both *and* still keeps the component mounted across switches (same route id, only a
> param changes) — so the charts never replay their entrance (verified: they key
> entrance/crossfade/stagger on `timeframe` only, `ticker-charts.tsx:21-50,80-112`).

One **ticker-primary route** with the selected creator as a **path param**:

- **Route: `/t/$symbol/$creator`.** `$creator = "all"` is the sentinel for the
  cross-creator (All) view; any other value selects that creator.
  - `/t/NOW/all` → All; `/t/NOW/kevvonz` → kevvonz selected.
  - During implementation, check whether this TanStack version supports an **optional
    path segment** (`/t/$symbol/{-$creator}`); if so, `/t/$symbol` can be All directly
    and the `"all"` sentinel is dropped. The `"all"` sentinel is the safe fallback and
    the spec is written against it.
- **Why a path param, not a search param:** real paths → ISR keys per-path and OG
  scrapers see the full URL (per-creator cards work). Same route id across creator
  switches → React preserves the component instance → no remount, no chart
  re-animation. The search→combobox morph is **local UI state** (fires on opening the
  search, not on selecting), so it needs no mount continuity — it works regardless.
- **Redirects (both `replace: true`, so the back button skips the redirector):**
  - `/t/$symbol` → `/t/$symbol/all`.
  - **`/c/$handle/ticker/$symbol`** → `/t/$symbol/$handle` (`beforeLoad` throws
    `redirect`). Preserves inbound links + bookmarks; OG scrapers follow the 3xx to
    the path-based target and get the correct per-creator card. The `/t` byCreator
    list rows switch to linking `/t/$symbol/$handle` directly (no redirect hop).
- **Symbol casing:** normalize `$symbol` to uppercase in the redirect and in the new
  loader (the OG route matches `c.ticker === symbol` case-sensitively, and ISR keys
  are case-split) so `/t/now/...` and `/t/NOW/...` don't fork.

### Loader

`/t/$symbol/$creator` loader (`params.symbol` uppercased, `params.creator`):

- **Always:**
  - `fetchCallsIndex()` → `summarizeTicker(calls, symbol)` (cross-creator summary;
    404 via `notFound()` when `callCount === 0`, unchanged).
  - `listCreators()` → project to names + avatars for shown handles (unchanged).
  - Price prefetch: `chartQuery(symbol, "1Y", firstDate)` (best-effort, degrade to
    baked), `fetchPrices(symbol)`, `fetchPrices("SPY")` — moved here from the old
    `/c/...` loader.
  - `prefetchHalal([symbol])` (unchanged).
  - **`firstDate` is the cross-creator earliest call date for this symbol, in BOTH
    modes** — it feeds the `chartQuery` key (`chart-query.ts`), so pinning it
    creator-independent keeps the chart **query key identical** across creator switches.
    The live chart data (`chartQuery` via TanStack Query) is therefore **not refetched**,
    and because the chart components key their entrance/crossfade on `timeframe` only,
    the **charts do not re-animate** on a creator switch. (Caveat, per the opus plan
    review: a `loaderDeps`-triggered re-run *does* re-call the static `fetchCallsIndex`
    /`fetchPrices` — those are served from the browser/CDN cache, cheap, and only change
    array identity, which the view-gating absorbs without a crossfade. The accurate claim
    is "chart query not refetched + no re-animation", not "zero refetch".) This is a
    deliberate behavior change from today's `/c` loader, which used the creator's earliest
    call across *all* symbols; the cross-creator window is correct for a ticker-primary page.
  - **Compute OG fields in the loader and return them** (`{ ogImg, ogTitle, rev }`):
    `head()` does **not** receive `search`/derived state, only `loaderData` (verified:
    every route reads OG inputs from `params`/`loaderData`; none read `search` in
    `head`). So the loader is the only place that can build the per-creator OG URL.
- **If `creator !== "all"` AND `creator` is a caller of this symbol:** also
  `fetchDataset(creator)` for that creator's detailed calls (1w/1m/3m/toDate + quote +
  shortcode), used by the detail table + that creator's chart markers, and for the
  `rev` cache-buster (same inputs as today's `/c` head: `[excess3m, ohlc.length,
  lastClose]`). A `creator` that isn't a caller (or a failed `fetchDataset`) **falls
  back to All** (log, drop the detail table + creator markers) — never crashes the route.

`loaderDeps: ({ params }) => ({ creator: params.creator })` — a creator switch re-runs
the loader (so `fetchDataset` for the newly-selected creator runs; `fetchCallsIndex`
/`fetchPrices` re-run too but hit the browser/CDN cache). The **chart query key**
(symbol+timeframe+firstDate) is creator-independent, so the live chart data is not
refetched and the chart stays mounted without re-animating.

### OG / head

`head({ params, loaderData })` reads the loader-computed fields:

- **Creator selected:** `og:image` = `/api/og/t/<creator>/<symbol>/<rev>` — this is a
  **dynamic ISR route** (`vite.config.ts`: `/api/og/** isr:21600`), NOT a prebuilt PNG
  (the original spec was wrong; `prebuild.ts` wipes `public/og/` and bakes only the
  home card). The `<rev>` segment is load-bearing: it's how `revalidate-creator.ts`
  busts the cached card after a re-score, so it must be computed from loaderData, not
  dropped.
- **All mode:** cross-creator OG = `/og.png` today (a dedicated cross-creator card is
  YAGNI). Title: `NOW — <name> · Signal Tracker` (creator) vs
  `NOW — who called it · Signal Tracker` (All).

## Page layout (`/t/$symbol/$creator`)

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
     `/t/$symbol/$handle` (selects that creator in place).
   - **Timeline swimlane** directly below, **rows aligned to the table's order**.
     See component spec.

4. **Calls detail table** — 1w/1m/3m/toDate + quote, tap-for-proof (the current
   `/c/...` table). Rendered **only when a creator is selected**; hidden in All mode.
   `ProofViewer` wired as today.

## Components

### CreatorSwitcher (`src/components/ticker/creator-switcher.tsx`)

A tab strip, right-aligned (`items-end`), no name text on triggers.

Tabs, left→right:
- **`All`** — default/active when `params.creator === "all"`. Label: short text "All"
  or a stacked-avatars glyph (pick "All" text for clarity; YAGNI on the glyph).
  Selecting → navigate `to="/t/$symbol/$creator" params={{ symbol, creator: "all" }}`.
- **Up to 3 avatar tabs** — order: **selected creator first** (when one is selected
  and it is a caller), then the most-recent *other* callers by `lastCallDate`, capped
  at 3 total avatars. Each trigger = avatar only; **cossui `Tooltip`** shows the name
  on hover/focus. Selecting → navigate
  `to="/t/$symbol/$creator" params={{ symbol, creator: handle }}`.
- **🔍 search tab** — lucide `Search` icon. On press it **morphs into a combobox
  input**: the active tab indicator expands to fill the whole tab container and
  becomes the combobox background (transitions-dev "sliding tabs" + "search/input
  reveal" patterns — animate the indicator's width/position, cross-fade icon→input).
  Combobox lists **all** callers; each row: avatar · name · last-call date ·
  call count. Selecting a row → same path navigation. Escape / blur / outside-click
  collapses back to the icon tab.
  (Ship now, per the user's call — even though it only earns its keep when a ticker
  has >3 callers. The morph is local UI state, so it is routing-independent.)

Active state: derived from `params.creator` ("all" → All tab). The morph/indicator uses
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

- **New route `/t/$symbol/$creator`** (`t.$symbol.$creator.tsx`): holds the full page
  — expanded loader (above), `loaderDeps` on `params.creator`, `head` reading
  loader-computed OG fields, and the component tree (header + switcher + charts +
  who-called table + timeline + conditional detail table). Uppercase `params.symbol`.
- **`/t/$symbol`** (existing `t.$symbol.tsx`): replace its component/loader with a
  redirect → `/t/$symbol/all` (`beforeLoad: ({ params }) => { throw redirect({ to:
  "/t/$symbol/$creator", params: { symbol: params.symbol.toUpperCase(), creator: "all" }, replace: true }) }`).
  (If optional path segments are available, fold All into `/t/$symbol/{-$creator}`
  instead and drop this redirect.)
- **`/c/$handle/ticker/$symbol`** (existing): replace component/loader with
  `beforeLoad: ({ params }) => { throw redirect({ to: "/t/$symbol/$creator", params: { symbol: params.symbol.toUpperCase(), creator: params.handle }, replace: true }) }`.
  Delete the now-dead chart/table body (moved into the new route).
- **Guard:** `creator === "all"` is the reserved sentinel. A real creator handle
  literally `"all"` is not expected; if it ever occurs, the All view simply wins
  (acceptable, documented).

## Error handling / fallbacks (unchanged semantics)

- Live-Yahoo prefetch failure → baked OHLC fallback (existing `.catch` + `buildChartView`).
- `fetchDataset(creator)` failure in a selected-creator view → degrade to All mode
  (log + drop the detail table + creator markers), never crash the route.
- **`creator` that isn't a caller of this symbol** (valid handle, no hits, or a typo'd
  path) → treat as All: render the cross-creator view, switcher highlights All, no
  detail table. Do not 404 (the *symbol* still has callers).
- Creator who called but has no priced calls (all returns null) → detail table renders
  "—" cells; markers still place at `postDate` (no divide-by-zero).
- Halal fail-open (existing).
- `summary.callCount === 0` → `notFound()` (existing — keyed on the symbol, not creator).

## Testing

- `call-filter.test.ts` (if present) / new: `summarizeTicker` now emits `lastCallDate`
  (max postDate per creator); assert on a multi-call fixture.
- Component: `CreatorSwitcher` renders All + ≤3 avatars + search; selecting navigates to
  the expected `params.creator`; hidden when one creator. `TickerCallTimeline` positions
  dots at expected x% for a known range (pure math, snapshot-free assertion).
- Redirect tests: `/t/$symbol` and `/c/$handle/ticker/$symbol` resolve to the expected
  `/t/$symbol/$creator` target (uppercased symbol, `replace: true`).
- Manual/visual (on `main` after merge per project workflow): morph animation,
  crosshair, marker swap between All and a creator. Note the IO/`useInView` automation
  artifact does not apply here (no reveal-gated values in this tree).

## Out of scope (YAGNI)

- Per-dot tooltips on the timeline (crosshair + date label is enough).
- Multi-creator marker color-coding on the price chart (All mode shows undistinguished
  dots; revisit only if it reads as noise).
- Stacked-avatar glyph for the "All" tab (plain "All" text).
- Animating the All↔creator chart-marker set beyond the existing restagger.
- **Adding ticker pages to the sitemap.** `sitemap[.]xml.ts` lists only `/` + `/c/<h>`
  today (never had ticker URLs, so the redirect breaks nothing). Now that `/t/$symbol`
  is a top-level stock page, listing them has SEO value — noted as a follow-up, not this
  change.

## Opus review resolutions (2026-06-18)

- **B1** (`head` has no `search`) → OG fields computed in the loader, read via
  `loaderData` in `head`. ✓ folded in.
- **B2** (OG cards are dynamic ISR, not prebuilt; `$rev` is load-bearing) → keep the
  `rev` computation in the loader from the creator dataset; corrected the false
  "prebuilt/byte-identical" claim. ✓
- **B3** (`?creator=` search param collides with path-ISR + OG query-stripping) →
  **architecture changed to a path param** (`/t/$symbol/$creator`). ✓ root cause removed.
- **S1** (redirect specifics) → `replace: true` stated; with path params the OG-on-redirect
  concern is moot (scrapers follow the 3xx to a path URL). ✓
- **S2** (sitemap) → documented as out-of-scope follow-up. ✓
- **S4** (`firstDate` ambiguity / query-key stability) → pinned to the cross-creator
  earliest in both modes so the chart query key is creator-independent. ✓
- **N1** (symbol casing) → uppercased in redirects + loader. ✓
- **N2** (non-caller / unpriced creator) → fallback-to-All + "—" cells documented. ✓
- **N3** (single-creator switcher hidden but redirect still targets a creator) → noted;
  consistent (detail table shows, switcher hidden). ✓
- **S3 / N4** (per-call tone not in index; combobox morph gold-plating) → tone stays
  neutral (consistent with index data); morph **shipped now** per the user's explicit call.
