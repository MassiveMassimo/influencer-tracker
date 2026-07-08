# SEO: favicon, dynamic OG images, head metadata — design

Date: 2026-06-03
Project: `influencer-tracker` (TanStack Start dashboard)

## Goal

Make the dashboard SEO/social-share ready:

1. On-brand favicon + app icons (replace CRA defaults).
2. Dynamic Open Graph images per page, generated at runtime, on-brand with the
   coastal palette and the chart "edge-fade" visual language.
3. Complete head metadata (OG, Twitter, canonical, sitemap, theme-color).

The OG background switches **light vs dark by real sunrise/sunset** for a fixed
location (runtime decision).

## Brand inputs (from `src/styles.css`)

- Light: `--foam #f3faf5`, `--sand #e7f0e8`, `--bg-base #e7f3ec`, `--sea-ink #173a40`,
  `--sea-ink-soft #416166`, `--lagoon #4fb8b2`, `--lagoon-deep #328f97`, `--palm #2f6a4a`.
- Dark: `--bg-base #0a1418`, `--foam #101d22`, `--sea-ink #d7ece8` (text), `--lagoon #60d7cf`,
  `--lagoon-deep #8de5db`, `--palm #6ec89a`.
- Fonts: Fraunces (display serif, `.display-title`), Geist Mono (mono / headings),
  Manrope (sans). OG uses **Fraunces** (display) + **Geist Mono** (labels/stats).
- App mark (`MobileNav.tsx:44`): lucide `LineChartIcon` on a rounded-square tile,
  gradient `from-foreground/80 to-foreground/40`, `ring-1 ring-border/60`.
- Edge-fade motif (`charts/fade-edges.ts`): horizontal opacity gradient
  `0% → 0, 15% → 1, 85% → 1, 100% → 0` applied as a mask.

## Data inputs

- `data/creators/index.json`: `{ handle, name, totalCalls, avgExcess3m, generatedAt, avatar? }[]`
  — enough for the creator OG card with **no** full-dataset read. (`avatar` is an
  inlined base64 data URI.)
- `data/creators/<handle>/dataset.json`: full `Dataset` (used only by the ticker OG
  for the per-call 3m excess).

## Architecture

### A. Shared OG renderer — `src/og/render.tsx`

Pure module, framework-agnostic:

- `renderOgPng(card: OgCard): Promise<Uint8Array>` — builds JSX → `satori` (SVG,
  1200×630) → `@resvg/resvg-js` (PNG).
- Fonts loaded once from local files (see Fonts below) and cached at module scope.
- `OgCard` is a discriminated union: `{ kind: 'home' } | { kind: 'creator', ... } |
{ kind: 'ticker', ... }`. The renderer composes a common frame (background,
  fade motif, brand footer mark) + a per-kind content block.
- Theme (`'light' | 'dark'`) is a field on the call, decided by the route (B).

satori cannot run visx, so the chart motif is a **hand-built SVG `<path>`**, not a
live chart (see C).

### B. Server routes (TanStack Start `server.handlers.GET`)

File-based routes in `src/routes/`, each returns a `Response` with
`Content-Type: image/png`:

| File                          | Path                      | Card                          |
| ----------------------------- | ------------------------- | ----------------------------- |
| `og[.]png.ts`                 | `/og.png`                 | home / default                |
| `og.$handle[.]png.ts`         | `/og/$handle.png`         | creator (reads `index.json`)  |
| `og.$handle.$symbol[.]png.ts` | `/og/$handle/$symbol.png` | ticker (reads `dataset.json`) |

(`[.]` escapes a literal dot in TanStack flat-file route names.)

Each handler:

1. Resolves the data it needs.
2. Computes `theme` via the sunrise/sunset helper (D).
3. Calls `renderOgPng` and returns the PNG with
   `Cache-Control: public, max-age=300, s-maxage=300` (short, so re-crawls can pick
   up the day/night flip; crawlers may still cache longer — accepted tradeoff).
4. On missing creator/handle → render a graceful fallback card (still 200) or 404;
   default to rendering the home card so embeds never break.

### C. Faded chart motif

A decorative `<path>` behind the text:

- Generate ~12 points with a deterministic PRNG **seeded from the handle string**
  (e.g. a small xmur3/mulberry32) so each creator's card is stable but distinct.
- Bias the overall trend up if `avgExcess3m >= 0`, down otherwise — "fits" the
  creator without being literal data.
- Render as an area: lagoon→palm vertical gradient fill at low opacity + a 2px
  lagoon stroke, with the edge-fade mask (`0/15/85/100`) applied.
- Home card uses a fixed seed (`"signal-tracker"`), neutral upward trend.

**Motif-first checkpoint:** satori's SVG support is limited and a programmatic
chart can look ugly (jagged joins, harsh fade, off gradient). So the motif is
built and rendered to standalone PNGs **first**, in isolation, and reviewed with
the user for "is this pretty" before any route/card work proceeds. Expect 1–2
iterations on curve smoothing (catmull-rom/bezier), fade softness, gradient stops,
and stroke weight. Only once the motif is approved do we compose the full cards.

### D. Day/night decision — `src/og/solar.ts`

Pure function, no dependency:

- `isDaytime(now: Date, lat: number, lng: number): boolean` — standard sunrise/sunset
  solar-position calc (NOAA algorithm: solar declination + hour angle for the
  sun's geometric zenith 90.833°). Returns true between sunrise and sunset.
- Location from env `OG_LAT` / `OG_LNG`, defaulting to NYC (`40.7128, -74.0060`) —
  the market's home.
- `theme = isDaytime(...) ? 'light' : 'dark'`.
- Unit-tested against known sunrise/sunset times (tolerance ± a few minutes).

### E. Favicon / app icons — `scripts/gen-icons.ts`

Generate once, commit as static files (no runtime cost):

- One master SVG of the app mark: rounded-square tile with a sea-ink gradient
  (`#173a40 → #416166`), `LineChartIcon` glyph stroked in foam, subtle ring.
- Rasterize via resvg to: `public/favicon.ico` (16/32/48), `public/icon-192.png`,
  `public/icon-512.png`, `public/apple-touch-icon.png` (180, padded), plus a crisp
  `public/icon.svg`.
- Favicon is **not** time-based (a file). Tile stays dark; the mark reads on both
  light and dark browser chrome.
- Update `public/manifest.json`: `name`/`short_name` "Signal Tracker",
  `theme_color` sea-ink, `background_color` foam, the new icons.

### F. Head metadata

- `src/og/site.ts`: `siteUrl()` — absolute origin from env `SITE_URL`
  (fallback `http://localhost:3000`). og:image **must** be absolute.
- `__root.tsx` `head()`: add favicon `links` (icon.svg, icon, apple-touch-icon,
  manifest), `theme-color` meta, and **default** OG/Twitter tags
  (`og:site_name`, `og:type=website`, `og:image=${siteUrl}/og.png`,
  `twitter:card=summary_large_image`, etc.).
- Per-route `head:` (uses route params / loader data):
  - `/` (index): title `Signal Tracker — influencer accuracy vs SPY`, description,
    canonical, `og:image=/og.png`.
  - `/c/$handle`: title `<Name> · Signal Tracker`, description mentioning calls +
    excess, canonical `/c/<handle>`, `og:image=/og/<handle>.png`, twitter image.
  - `/c/$handle/ticker/$symbol`: title `$SYMBOL — <Name> · Signal Tracker`,
    `og:image=/og/<handle>/<symbol>.png`.
- `src/routes/sitemap[.]xml.ts` — `GET` returns `application/xml` enumerating `/`,
  each `/c/<handle>`, built from `index.json`.
- `public/robots.txt` — already present; add `Sitemap: ${SITE_URL}/sitemap.xml` line.

## New dependencies

`satori`, `@resvg/resvg-js`, `@fontsource/fraunces`, `@fontsource/geist-mono`
(static TTFs — satori needs static instances, not the variable woff2 already
installed via `@fontsource-variable/geist-mono`).

## Fonts for satori

Read static `.ttf` bytes from the installed `@fontsource/*` packages at module
init (Fraunces 500/700, Geist Mono 400/600). Cache as `ArrayBuffer`s. No network.

## Preview-before-commit gate

Two staged previews, both before any commit:

1. **Motif preview (first):** render the faded chart motif alone to PNGs (a few
   seeds, light + dark) and get the user's sign-off on the style. Iterate here
   until it's pretty.
2. **Full preview:** after the cards are composed, render all OG variants
   (home + a real creator + a ticker, light + dark via theme override) + the
   favicon set, and send them to the user. Commit only after approval.

## Verification / success criteria

- `bunx tsc --noEmit` clean; `bun test` passes (incl. new `solar.test.ts`).
- `GET /og.png`, `/og/<handle>.png`, `/og/<handle>/<symbol>.png` each return a valid
  1200×630 PNG.
- View-source on `/`, `/c/<handle>`, ticker pages shows correct absolute og:image,
  twitter:card, canonical, title/description.
- Favicon renders in the browser tab; `manifest.json` validates.
- OG theme flips with a mocked clock (daytime → light, night → dark).

## Out of scope

- Live per-viewer day/night (platform caching prevents it; documented tradeoff).
- Deriving the motif from real price series (kept decorative, seeded).
- JSON-LD / structured data beyond the sitemap (could be a follow-up).
