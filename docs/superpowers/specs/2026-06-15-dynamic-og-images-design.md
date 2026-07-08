# Dynamic OG Images — Design

Date: 2026-06-15
Status: Approved (pending implementation plan)

## Problem

OG cards are pre-rendered to static PNGs at build (`scripts/prebuild.ts` →
`public/og/*.png`) from the committed static `dataset.json`. Under `USE_DB=1`
(live in prod), page data refreshes from Neon within the 6h ISR TTL **without a
redeploy**, but the OG PNGs stay frozen at last deploy — so a shared card can show
materially stale stats (returns, call counts) versus the live page.

Goal: OG cards reflect current DB stats **for new shares**, while preserving the
current performance posture (satori/resvg never run on hot request paths; cards
served from the CDN, rendered rarely).

## Key constraint (why not "pure per-request dynamic")

OG freshness is a **share-time snapshot** problem, not a serve-time one. Research
findings:

- Crawlers fetch the `og:image` **once**, cache the bytes by URL, and on
  X/LinkedIn **freeze the card to the post permanently**. Slack/Discord/etc. cache
  minutes-to-weeks. Per-request rendering only "wins" on the _first share of a URL
  after data changed_ — a window the platforms otherwise discard.
- The reliable lever is **versioning the `og:image` URL** (path-based, not `?v=`
  — some crawlers normalize query strings). A new URL on data-change → new shares
  get fresh bytes.
- `@resvg/resvg-js` is native → **Node runtime only** (faster than WASM/edge).
  Reuse the existing ISR + `x-prerender-revalidate` plumbing for caching/bust.

## Approach: cached-dynamic, self-busting via rev

A dynamic server route renders the card from live DB but is **ISR-cached**, and the
`og:image` URL carries a content **rev** so it self-busts.

```
Page head() (SSR, ISR'd)                 OG route (ISR'd, Node runtime)
─ reads loaderData (DB)            ─ reads same DB (or static fallback)
─ computes rev = hash(stats)       ─ renders renderOgPng(card) → PNG
─ emits og:image =                 ─ Content-Type: image/png
   /api/og/c/<handle>/<rev>.png    ─ cached by URL (incl. rev)
```

The OG route needs **no new revalidation wiring**: rev in the URL means a stat
change → new URL → automatic CDN cache-miss → render once → cached. Stale-rev URLs
stay cached harmlessly (they only live in already-frozen social posts). OG freshness
rides the **page route's existing** ISR + revalidate-token bust (already in
`scripts/revalidate-creator.ts`): when the page re-renders post-ingest, `head()`
emits the new rev, and the next share fetches a fresh image.

## Components

### 1. OG server routes

- `src/routes/api/og/c.$handle.$rev.tsx` → `/api/og/c/<handle>/<rev>.png`
- `src/routes/api/og/t.$handle.$symbol.$rev.tsx` → `/api/og/t/<handle>/<symbol>/<rev>.png`

TanStack Start server routes (`createFileRoute` + `server.handlers.GET`), returning
`new Response(buffer, { headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL } })`.

- Read stats via the existing `readFromDbOrNull` → `readDataset(getDb(), handle)`
  path (same as pages), so OG always matches page data.
- satori/resvg are **dynamic-imported inside the handler** so they stay off every
  other code path. Native resvg → Node runtime.
- `rev` is **only a cache key** — the route renders _current_ DB stats. Page
  `head()` and the route read the same DB within the same ISR window, so a fresh
  share gets matching rev + content.
- `.png` suffix is carried on the `$rev` segment (param value is `<rev>.png`; strip
  the extension before use, or route as a literal).

### 2. URL versioning (`rev`)

- New helper `ogRev(parts: (string | number | null)[]): string` in `src/og/` —
  first 8 hex chars of a hash over the card's visible stat fields.
  - Creator: `[avgExcess3m, totalCalls]`.
  - Ticker: `[excess3m, closesFingerprint]` where `closesFingerprint` is a cheap
    digest of the line-graph closes (e.g. length + first + last + a rounded sum) so
    the rev changes when the drawn line changes.
- Emitted from each page's `head()` using `loaderData` it already has — **no extra
  fetch**. Path-based: `/api/og/c/<handle>/<rev>.png`,
  `/api/og/t/<handle>/<symbol>/<rev>.png`.

### 3. Ticker card line-graph background (new)

- Extend `OgCard.ticker` with `closes: number[]`.
  - Source: the **longest `spark`** among the symbol's calls (earliest call = most
    history) — already in the dataset, no extra fetch.
- New `buildLineChartBackgroundSvg()` (sibling to `buildCardBackgroundSvg` in
  `src/og/card-bg.ts`): downsample closes to ~48 points, draw an SVG polyline + soft
  area fill; up/down color from first-vs-last close. Used for **ticker** cards only;
  creator + home keep the existing seeded background.
- Cost: extra path data in the SVG that resvg already rasterizes — **no extra resvg
  pass**.

### 4. prebuild + fallback

- Drop per-creator and per-ticker PNG emission from `scripts/prebuild.ts` (the two
  loops writing `public/og/<handle>.png` and `public/og/<handle>/<symbol>.png`).
  They become dead files once `head()` points at `/api/og/*`. **Keep the home card**
  (`public/og.png`).
- Resilience: the data path itself falls back (DB → static dataset JSON via
  `readFromDbOrNull`/`fetchDataset`). Hard failure → render a minimal branded card,
  never a 500. No dependency on stale static PNGs.

### 5. Meta-tag wiring

Update `og:image` / `twitter:image` in the affected `head()` functions:

- Creator page (`src/routes/c.$handle.index.tsx`): `/api/og/c/<handle>/<rev>.png`.
- Ticker page (`src/routes/c.$handle.ticker.$symbol.tsx`):
  `/api/og/t/<handle>/<symbol>/<rev>.png`.
- Home + any other page: unchanged (static).
- Absolute URLs via `siteUrl()` (build-time `VITE_SITE_URL`), as today.

### 6. Caching config

- `vite.config.ts` routeRules: `'/api/og/**': { isr: 21600 }`.
- Reuse `CACHE_CONTROL` from `src/lib/api-serve.ts`.
- No `scripts/revalidate-creator.ts` change (OG self-busts via rev; page bust
  already emits the new rev).

## Data flow (request)

1. Crawler requests `/c/<handle>/ticker/<symbol>` (ISR-cached page).
2. `head()` (rendered at SSR/ISR time from DB `loaderData`) emits
   `og:image = /api/og/t/<handle>/<symbol>/<rev>.png`.
3. Crawler fetches that image URL.
4. OG route: ISR cache HIT → CDN serves PNG (no render). MISS (new rev / cold) →
   read DB, build card (ticker card draws line-graph bg from `closes`), render PNG,
   cache.
5. Ingest updates data → `revalidate-creator.ts` busts the page route → page
   re-renders with a new `rev` → step 2 emits a new image URL → next share is fresh.

## Error handling

- DB read fails → fall back to static dataset asset (same as page path).
- Dataset/stats missing → render a minimal branded card (brand lockup only), 200
  `image/png`. Never 500, never block a crawler.
- Empty / single-point `closes` → line-graph background degrades to a flat baseline
  (no crash).

## Testing

- Unit:
  - `ogRev` — stable for identical inputs, changes when any stat field changes.
  - `buildLineChartBackgroundSvg` — valid SVG string; handles `[]`, `[x]`, and a
    normal series; up vs down color.
  - OG route handler — returns `image/png`; renders correct card for DB-present and
    fallback paths; minimal card on missing data.
- Manual (on `main` after merge): hit `/api/og/c/<h>/<rev>.png` and
  `/api/og/t/<h>/<sym>/<rev>.png` locally; confirm a stat change yields a new `rev`
  in the page `head()`; spot-check the ticker line-graph background renders.

## Out of scope

- Home card stays static-at-build.
- No CDN tag-purge (`invalidateByTag`) — not wired through Nitro Build-Output ISR;
  the rev-in-URL + page-route bust covers freshness.
- No edge/WASM renderer migration — native resvg on Node is faster and already used.
- Retroactively refreshing already-shared (frozen) posts — structurally impossible.
- **Implementation note (extensionless URLs):** the served OG URLs are extensionless
  (`/api/og/c/<handle>/<rev>`, `/api/og/t/<handle>/<symbol>/<rev>`), not `.png` as shown
  above — TanStack/Nitro 404s a `$rev` segment with a file extension (static-asset lookup).
  The `Content-Type: image/png` response header is authoritative for crawlers.

## Files touched

- New: `src/routes/api/og/c.$handle.$rev.tsx`,
  `src/routes/api/og/t.$handle.$symbol.$rev.tsx`, `src/og/og-rev.ts`.
- Edit: `src/og/render.tsx` (ticker `closes` + line-graph bg), `src/og/card-bg.ts`
  (`buildLineChartBackgroundSvg`), `scripts/prebuild.ts` (drop creator/ticker
  loops), `vite.config.ts` (routeRules), `src/routes/c.$handle.index.tsx` +
  `src/routes/c.$handle.ticker.$symbol.tsx` (og:image URLs).
