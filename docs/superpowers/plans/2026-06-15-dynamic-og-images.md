# Dynamic OG Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve creator + ticker OG cards from dynamic, DB-fresh, ISR-cached routes whose `og:image` URLs carry a content `rev`, so shared cards reflect current stats; give ticker cards a real price line-graph background.

**Architecture:** A dynamic server route renders the card from live DB but is ISR-cached (6h). The page `head()` computes a short `rev` hash from the stats it already has and emits `og:image=/api/og/{c,t}/…/<rev>.png`. A stat change → new URL → automatic CDN cache-miss → render-once-cache. No new revalidation wiring: OG freshness rides the page route's existing ISR + `x-prerender-revalidate` bust.

**Tech Stack:** TanStack Start (Nitro→Vercel), satori + `@resvg/resvg-js` (native, Node runtime), Vercel ISR via Nitro `routeRules`, Neon Postgres (`USE_DB=1`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-15-dynamic-og-images-design.md`

**Conventions:** tests use `bun:test`; `#/` aliases `src/`; typecheck `bunx tsc --noEmit`; OG theme is frozen `"dark"`. Implement in a git worktree; visual/manual verification happens on `main` after merge.

---

### Task 1: `ogRev` content-hash helper

**Files:**

- Create: `src/og/og-rev.ts`
- Test: `src/og/og-rev.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/og/og-rev.test.ts
import { test, expect } from "bun:test";
import { ogRev } from "./og-rev";

test("ogRev is stable for identical inputs", () => {
  expect(ogRev([0.124, 42])).toBe(ogRev([0.124, 42]));
});

test("ogRev changes when any field changes", () => {
  expect(ogRev([0.124, 42])).not.toBe(ogRev([0.125, 42]));
  expect(ogRev([0.124, 42])).not.toBe(ogRev([0.124, 43]));
});

test("ogRev tolerates null/undefined and returns 8 hex chars", () => {
  expect(ogRev([null, undefined])).toMatch(/^[0-9a-f]{8}$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/og/og-rev.test.ts`
Expected: FAIL — `Cannot find module './og-rev'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/og/og-rev.ts
// Short, dependency-free content hash for cache-busting OG image URLs. Isomorphic
// (no node:crypto) so it is safe to call from route head() in the client bundle.
// A new rev means a new og:image URL, which forces crawlers to refetch the card.
export function ogRev(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => String(p ?? "")).join("|");
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/og/og-rev.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/og/og-rev.ts src/og/og-rev.test.ts
git commit -m "feat(og): ogRev content-hash helper for cache-busting OG urls"
```

---

### Task 2: `buildLineChartBackgroundSvg` (ticker line-graph background)

**Files:**

- Modify: `src/og/card-bg.ts` (append a new exported function)
- Test: `src/og/card-bg.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/og/card-bg.test.ts
import { test, expect } from "bun:test";
import { buildLineChartBackgroundSvg } from "./card-bg";
import { palette } from "./theme";

const base = { theme: "dark" as const, palette: palette("dark"), width: 1200, height: 630 };

test("renders an svg with a line path for a normal series", () => {
  const svg = buildLineChartBackgroundSvg({ ...base, closes: [10, 12, 11, 15, 14], up: true });
  expect(svg).toContain("<svg");
  expect(svg).toContain("<path");
});

test("handles empty closes without crashing (no line, still valid svg)", () => {
  const svg = buildLineChartBackgroundSvg({ ...base, closes: [], up: true });
  expect(svg.startsWith("<svg")).toBe(true);
});

test("handles a single point", () => {
  const svg = buildLineChartBackgroundSvg({ ...base, closes: [42], up: false });
  expect(svg).toContain("<svg");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/og/card-bg.test.ts`
Expected: FAIL — `buildLineChartBackgroundSvg` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/og/card-bg.ts` (the file already defines `hexToRgba`, `CardBgOpts`, and `buildCardBackgroundSvg`; reuse `hexToRgba`):

```ts
export interface LineBgOpts {
  closes: number[];
  up: boolean;
  theme: OgTheme;
  palette: OgPalette;
  width: number;
  height: number;
}

// Ticker-card background: solid base + trend glow + the symbol's price line drawn
// across the lower band of the card (so it never collides with the headline text).
// Downsamples to <=64 points; degrades to base+glow for empty/flat series.
export function buildLineChartBackgroundSvg({
  closes,
  up,
  theme,
  palette,
  width,
  height,
}: LineBgOpts): string {
  const lineColor = up ? palette.lagoon : palette.down;
  const glowA = theme === "dark" ? 0.22 : 0.16;

  // Downsample evenly to at most 64 points.
  const MAX = 64;
  let pts = closes;
  if (closes.length > MAX) {
    pts = Array.from(
      { length: MAX },
      (_, i) => closes[Math.round((i * (closes.length - 1)) / (MAX - 1))],
    );
  }

  // Lower band of the card: y in [bandTop, bandBottom].
  const bandTop = height * 0.5;
  const bandBottom = height * 0.94;
  let linePath = "";
  let areaPath = "";
  if (pts.length >= 2) {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const xy = pts.map((c, i) => {
      const x = (i / (pts.length - 1)) * width;
      const y = bandBottom - ((c - min) / span) * (bandBottom - bandTop);
      return [x, y] as const;
    });
    linePath = xy
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");
    areaPath = `${linePath} L${width} ${bandBottom} L0 ${bandBottom} Z`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="70%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${hexToRgba(lineColor, glowA)}"/>
      <stop offset="100%" stop-color="${hexToRgba(lineColor, 0)}"/>
    </radialGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${hexToRgba(lineColor, 0.18)}"/>
      <stop offset="100%" stop-color="${hexToRgba(lineColor, 0)}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${palette.bg}"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  ${areaPath ? `<path d="${areaPath}" fill="url(#area)"/>` : ""}
  ${linePath ? `<path d="${linePath}" fill="none" stroke="${hexToRgba(lineColor, 0.55)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/og/card-bg.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/og/card-bg.ts src/og/card-bg.test.ts
git commit -m "feat(og): line-graph card background for ticker OG cards"
```

---

### Task 3: Wire `closes` into `OgCard.ticker` and `renderOgPng`

**Files:**

- Modify: `src/og/render.tsx` (OgCard type, extract `svgToUri`, pick bg by card kind)
- Test: `src/og/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/og/render.test.ts
import { test, expect } from "bun:test";
import { renderOgPng } from "./render";

test("renders a ticker card with a line-graph background to a PNG", async () => {
  const png = await renderOgPng({
    kind: "ticker",
    theme: "dark",
    symbol: "PLTR",
    company: "Palantir",
    name: "Test Creator",
    handle: "test",
    excess3m: 0.12,
    closes: [10, 11, 9, 12, 14, 13, 15, 16, 14, 17],
  });
  // PNG magic bytes: 89 50 4E 47
  expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
});

test("renders a ticker card with no closes (falls back to seeded bg)", async () => {
  const png = await renderOgPng({
    kind: "ticker",
    theme: "dark",
    symbol: "AAPL",
    name: "Test Creator",
    handle: "test",
    excess3m: null,
  });
  expect(png.subarray(0, 4).toString("hex")).toBe("89504e47");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/og/render.test.ts`
Expected: FAIL — TS error: `closes` not on the ticker `OgCard` variant (and/or runtime if it compiles).

- [ ] **Step 3: Implement**

In `src/og/render.tsx`:

(a) Add `closes` to the ticker variant of `OgCard` (the `kind: "ticker"` object, currently ending with `excess3m: number | null;`):

```ts
  | {
      kind: "ticker";
      theme: OgTheme;
      symbol: string;
      company?: string;
      name: string; // creator name
      handle: string;
      excess3m: number | null;
      closes?: number[]; // symbol price series for the line-graph background
    };
```

(b) Update the import on line 4 to also pull the new bg builder:

```ts
import { buildCardBackgroundSvg, buildLineChartBackgroundSvg } from "./card-bg";
```

(c) Replace `cardBgUri` (the current function at lines ~35-39) with a generic `svgToUri` plus the existing seeded helper kept inline:

```ts
// NOTE: resvg runs twice per render (background here, final card in renderOgPng)
// and the bg is inlined as a base64 data URI. Fine per-request; the /api/og/*
// routes are ISR-cached so this runs once per content rev, not per request.
function svgToUri(svg: string): string {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  return `data:image/png;base64,${png.toString("base64")}`;
}
```

(d) In `renderOgPng` replace the `const bg = cardBgUri(seed, up, card.theme, pal);` line with a card-kind-aware background:

```ts
const bgSvg =
  card.kind === "ticker" && card.closes && card.closes.length > 0
    ? buildLineChartBackgroundSvg({
        closes: card.closes,
        up,
        theme: card.theme,
        palette: pal,
        width: W,
        height: H,
      })
    : buildCardBackgroundSvg({ seed, up, theme: card.theme, palette: pal, width: W, height: H });
const bg = svgToUri(bgSvg);
```

(`seed`, `up`, and `pal` are already computed just above that line — leave them as-is; `seed` is still used for the non-ticker/no-closes branch.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/og/render.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/og/render.tsx src/og/render.test.ts
git commit -m "feat(og): ticker cards use price line-graph background"
```

---

### Task 4: Dynamic creator OG route

**Files:**

- Create: `src/routes/api/og/c.$handle.$rev.tsx`

Reads the DB index (DB-fresh under `USE_DB=1`, falls back to the bundled static index) for the creator's avatar + stats, renders the creator card, and returns `image/png`. The `$rev` param is a cache-buster and is intentionally unused by the handler.

- [ ] **Step 1: Create the route**

```tsx
// src/routes/api/og/c.$handle.$rev.tsx
import { createFileRoute } from "@tanstack/react-router";
import { readFromDbOrNull } from "#/lib/data.ts";
import { CACHE_CONTROL, isSafeAssetKey } from "#/lib/api-serve.ts";
import type { IndexEntry } from "#/lib/dataset-source.ts";

// Dynamic creator OG card. ISR-cached (vite routeRules); the $rev path segment busts
// the CDN cache when stats change (the page head() emits a new rev). $rev is unused here.
export const Route = createFileRoute("/api/og/c/$handle/$rev")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { handle } = params;
        if (!isSafeAssetKey(handle)) {
          return new Response("invalid handle", { status: 404 });
        }

        let entry: IndexEntry | undefined;
        // SSR literal at the call site so Rollup DCE keeps neon/db out of any client chunk.
        if (import.meta.env.SSR) {
          const idx = await readFromDbOrNull(`og index ${handle}`, async () => {
            const { getDb } = await import("../../../../db/client");
            const { readIndex } = await import("#/lib/db-read.ts");
            return readIndex(getDb());
          });
          entry = idx?.find((e) => e.handle === handle);
        }
        if (!entry) {
          const { loadIndex } = await import("#/lib/dataset-source.ts");
          entry = loadIndex().find((e) => e.handle === handle);
        }

        const { renderOgPng } = await import("#/og/render.tsx");
        const png = await renderOgPng(
          entry
            ? {
                kind: "creator",
                theme: "dark",
                name: entry.name,
                handle,
                avatar: entry.avatar,
                excess3m: entry.avgExcess3m,
                totalCalls: entry.totalCalls,
              }
            : { kind: "home", theme: "dark" }, // unknown handle: minimal branded card, never 500
        );
        return new Response(png, {
          headers: { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL },
        });
      },
    },
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0. (If the route-tree codegen complains the path isn't registered, run the dev/build once — TanStack regenerates `routeTree.gen.ts` from the file. See Task 9.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/og/c.$handle.$rev.tsx
git commit -m "feat(og): dynamic creator OG image route"
```

---

### Task 5: Dynamic ticker OG route

**Files:**

- Create: `src/routes/api/og/t.$handle.$symbol.$rev.tsx`

Reads the creator dataset + the symbol's baked prices (both DB-first with static fallback via `fetchDataset`/`fetchPrices`), renders the ticker card with the price line-graph background, returns `image/png`. Any failure → minimal ticker card, never 500.

- [ ] **Step 1: Create the route**

```tsx
// src/routes/api/og/t.$handle.$symbol.$rev.tsx
import { createFileRoute } from "@tanstack/react-router";
import { CACHE_CONTROL, isSafeAssetKey } from "#/lib/api-serve.ts";

// Dynamic ticker OG card with the symbol's price line-graph background. ISR-cached;
// $rev busts the CDN cache on data change (page head() emits a new rev). $rev unused here.
export const Route = createFileRoute("/api/og/t/$handle/$symbol/$rev")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { handle, symbol } = params;
        if (!isSafeAssetKey(handle) || !isSafeAssetKey(symbol)) {
          return new Response("invalid", { status: 404 });
        }

        const { renderOgPng } = await import("#/og/render.tsx");
        const headers = { "Content-Type": "image/png", "Cache-Control": CACHE_CONTROL };

        try {
          const { fetchDataset, fetchPrices } = await import("#/lib/data.ts");
          const [ds, prices] = await Promise.all([fetchDataset(handle), fetchPrices(symbol)]);
          const calls = ds.calls.filter((c) => c.ticker === symbol);
          const png = await renderOgPng({
            kind: "ticker",
            theme: "dark",
            symbol,
            company: calls[0]?.company,
            name: ds.creator.name,
            handle,
            excess3m: calls[0]?.returns?.["3m"]?.excess ?? null,
            closes: prices.map((p) => p.c),
          });
          return new Response(png, { headers });
        } catch (e) {
          console.warn(`[og ticker] ${handle}/${symbol} render failed, minimal card`, e);
          const png = await renderOgPng({
            kind: "ticker",
            theme: "dark",
            symbol,
            name: handle,
            handle,
            excess3m: null,
          });
          return new Response(png, { headers });
        }
      },
    },
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/og/t.$handle.$symbol.$rev.tsx
git commit -m "feat(og): dynamic ticker OG image route with price line-graph"
```

---

### Task 6: ISR cache rule for the OG routes

**Files:**

- Modify: `vite.config.ts` (the `nitro.routeRules` block)

- [ ] **Step 1: Add the route rule**

In `vite.config.ts`, inside `routeRules` alongside the existing `'/api/dataset/**': { isr: 21600 },` entries, add:

```ts
      '/api/og/**': { isr: 21600 },
```

- [ ] **Step 2: Verify the file parses**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat(og): ISR-cache the dynamic OG routes (6h)"
```

---

### Task 7: Point page `head()` at the dynamic, rev-versioned OG URLs

**Files:**

- Modify: `src/routes/c.$handle.index.tsx` (creator page `head()`)
- Modify: `src/routes/c.$handle.ticker.$symbol.tsx` (ticker page `head()`)

- [ ] **Step 1: Creator page — import `ogRev` and version the URL**

In `src/routes/c.$handle.index.tsx`, add the import near the other `#/og` import (line ~33, beside `import { siteUrl } from "#/og/site.ts";`):

```ts
import { ogRev } from "#/og/og-rev.ts";
```

Replace the `head()` body's image line. Current:

```ts
const name = loaderData?.creator.name ?? params.handle;
const img = siteUrl(`/og/${params.handle}.png`);
```

New:

```ts
const name = loaderData?.creator.name ?? params.handle;
const sc = loaderData?.scorecard;
const rev = ogRev([sc?.avgExcess["3m"], sc?.totalCalls]);
const img = siteUrl(`/api/og/c/${params.handle}/${rev}.png`);
```

- [ ] **Step 2: Ticker page — import `ogRev` and version the URL**

In `src/routes/c.$handle.ticker.$symbol.tsx`, add beside `import { siteUrl } from "#/og/site.ts";` (line ~24):

```ts
import { ogRev } from "#/og/og-rev.ts";
```

Replace the `head()` body's image line. Current:

```ts
const name = loaderData?.creator.name ?? params.handle;
const img = siteUrl(`/og/${params.handle}/${params.symbol}.png`);
```

New (rev from the symbol's first-call 3m excess + the baked OHLC fingerprint, all already on `loaderData`):

```ts
const name = loaderData?.creator.name ?? params.handle;
const symCalls = loaderData?.calls.filter((c) => c.ticker === params.symbol) ?? [];
const excess3m = symCalls[0]?.returns?.["3m"]?.excess ?? null;
const ohlc = loaderData?.bakedOhlc ?? [];
const lastClose = ohlc.length ? ohlc[ohlc.length - 1].c : 0;
const rev = ogRev([excess3m, ohlc.length, Math.round(lastClose)]);
const img = siteUrl(`/api/og/t/${params.handle}/${params.symbol}/${rev}.png`);
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/routes/c.$handle.index.tsx src/routes/c.$handle.ticker.$symbol.tsx
git commit -m "feat(og): point creator+ticker og:image at rev-versioned dynamic routes"
```

---

### Task 8: Stop pre-rendering creator + ticker PNGs at build

**Files:**

- Modify: `scripts/prebuild.ts` (the OG-emission section; keep home card, dataset copy, prices copy)

The current section emits the home card, loops creators to emit creator PNGs, then loops creators to (a) collect `datasets`, (b) copy each `dataset.json` to `public/datasets/`, and (c) push per-ticker render jobs run via `pool(...)`. Keep (a) and (b) and the home card; drop the creator-emit loop and all per-ticker rendering.

- [ ] **Step 1: Replace the section**

Find the block that starts with `// Home + one card per creator.` and ends just before the `if (existsSync(PRICES_SRC)) {` price-copy block (it includes the creator `for` loop, the `const datasets`/`tickerJobs` declarations, the second `for` loop, and the `pool(tickerJobs, 8, …)` call). Replace that entire block with:

```ts
// Home card only — creator + ticker cards are now rendered on demand by the
// /api/og/{c,t}/* routes (dynamic, DB-fresh). See
// docs/superpowers/specs/2026-06-15-dynamic-og-images-design.md.
await emit({ kind: "home", theme: THEME }, join(OG_DIR, "..", "og.png"));

// Per-creator: copy the dataset as a static CDN asset (panic fallback for the API
// read routes) and collect datasets for the calls-index / llms.txt below.
const datasets: Dataset[] = [];
for (const e of index) {
  const ds = readJson(join(DATA, e.handle, "dataset.json"));
  datasets.push(ds as Dataset);
  cpSync(join(DATA, e.handle, "dataset.json"), join(DS_DIR, `${e.handle}.json`));
}
```

- [ ] **Step 2: Remove now-unused symbols**

After the edit, `tickerJobs`, the `pool` helper (if it was only used for ticker rendering), and possibly the `OgCard` import may be unused. `emit` still uses `OgCard`, so keep that import. Run typecheck to find unused symbols and delete only those the edit orphaned:

Run: `bunx tsc --noEmit`
Expected: exit 0. If it reports `'pool' is declared but never read` (or similar), delete the now-dead `pool` definition/import. Do not remove anything still referenced (`datasets`, `emit`, `cpSync`, `DS_DIR`, `readJson`).

- [ ] **Step 3: Smoke-run prebuild**

Run: `bun run scripts/prebuild.ts`
Expected: completes; writes `public/og.png`, `public/datasets/<h>.json`, `public/prices/` — and **no** `public/og/<h>.png` or `public/og/<h>/<sym>.png`. Confirm:

Run: `ls public/og 2>/dev/null; echo "exit ${?}"`
Expected: only `og.png` at `public/` root (note `OG_DIR` is `public/og`; home writes to `public/og/../og.png` = `public/og.png`), and no per-creator subdirectories. (An empty or absent `public/og/` dir is fine.)

- [ ] **Step 4: Commit**

```bash
git add scripts/prebuild.ts
git commit -m "chore(og): stop pre-rendering creator+ticker PNGs (now dynamic)"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `bun test`
Expected: green (DB-gated tests skip without `DATABASE_URL_TEST`).

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Build (regenerates route tree + Vercel output; confirms the new routes compile and satori/resvg bundle)**

Run: `bun run build`
Expected: completes without error. The two new `/api/og/*` routes appear in the generated route tree.

- [ ] **Step 4: Manual check (after merge to `main`, on the dev server)**

- Start the dev server, open a creator page and a ticker page, and view source: confirm `og:image` is `…/api/og/c/<handle>/<rev>.png` and `…/api/og/t/<handle>/<symbol>/<rev>.png`.
- Open each OG URL directly in the browser: confirm a PNG renders, and that the **ticker** card shows the price line-graph background.
- Sanity-check rev sensitivity: the rev string changes if the underlying stat changes (e.g. compare two creators / two symbols — distinct revs).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(og): verification fixups for dynamic OG images"
```

---

## Notes for the implementer

- **No revalidation wiring change.** `scripts/revalidate-creator.ts` is intentionally untouched: the OG routes self-bust via the `rev` in their URL, and the page routes (already in the revalidation set) re-emit the new rev when busted post-ingest.
- **Home card stays static** (`public/og.png` via prebuild); only creator + ticker went dynamic.
- **Runtime:** `@resvg/resvg-js` is native → the OG routes must run on the Node runtime (default for these server routes; do not mark them edge).
- **Frozen theme:** OG cards render `theme: "dark"` to match the existing prebuild output.
