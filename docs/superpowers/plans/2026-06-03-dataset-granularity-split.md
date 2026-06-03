# Dataset Granularity Split + Price Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping per-ticker OHLC to the browser. Split the per-creator `dataset.json` into slim display data (calls + scorecard, with a tiny baked sparkline series per call) and a shared, deduped per-ticker price store fetched only when needed — cutting creator/ticker page HTML from ~6 MB to <1 MB.

**Architecture:** Today `score.ts` bakes a `tickers` map (daily OHLC for every called ticker, ~5.2 MB) into each `dataset.json`, which is dehydrated whole into SSR HTML. This phase removes `tickers` from the served dataset. Each `Call` gains a `spark: number[]` (downsampled closes from its post date forward) so the creator-page sparklines need no OHLC. Baked OHLC moves to shared `data/prices/<symbol>.json` files (deduped across creators), copied to `public/prices/` at build; the ticker page fetches only its symbol + SPY as the Yahoo-error fallback. This stays entirely within the current build-time-static model — no Blob, cron, or VM yet (those are later phases).

**Tech Stack:** Bun (runtime + `bun test`), TypeScript, Zod (schema), TanStack Start/Router (routes + loaders), satori/resvg (OG, unaffected). `#/` aliases `src/`.

---

## File Structure

**New files:**
- `src/lib/spark.ts` — pure `buildSpark(ohlc, fromDate, maxPoints)` → downsampled closes. One responsibility: produce a sparkline series.
- `src/lib/spark.test.ts` — tests for `buildSpark`.
- `src/lib/prices-merge.ts` — pure `mergePrices(existing, incoming)` → union-by-date OHLC. One responsibility: dedupe/merge price bars.
- `src/lib/prices-merge.test.ts` — tests for `mergePrices`.
- `scripts/migrate-split-prices.ts` — one-time migration: restructures the existing committed `dataset.json` files into the new slim shape + shared price store, reusing `buildSpark`/`mergePrices`.

**Modified files:**
- `src/lib/types.ts` — `Dataset` loses `tickers`; `Call` gains `spark?: number[]`.
- `src/lib/schema.ts` — `DatasetSchema` loses `tickers`; `CallSchema` gains `spark`; export `PriceFileSchema`.
- `src/lib/schema.test.ts` — fixture updated to the slim shape; add `PriceFileSchema` test.
- `pipeline/score.ts` — `assembleDataset` bakes `spark`, stops building `tickers`; `score()` writes shared `data/prices/<symbol>.json` via `mergePrices`.
- `pipeline/score.test.ts` — assert `spark` present, `tickers` absent.
- `src/lib/data.ts` — add `fetchPrices(symbol)`.
- `src/components/Sparkline.tsx` — prop changes from `bars: OhlcBar[]` to `closes: number[]`.
- `src/routes/c.$handle.index.tsx` — `CallRow` renders `<Sparkline closes={call.spark ?? []} …>`; drop OHLC plumbing.
- `src/routes/c.$handle.ticker.$symbol.tsx` — replace `ds.tickers[…]` with fetched price files; remove the interim slimming hotfix.
- `scripts/prebuild.ts` — copy `data/prices/` → `public/prices/`.
- `.gitignore` — ignore generated `public/prices/`.

---

### Task 1: `buildSpark` helper

**Files:**
- Create: `src/lib/spark.ts`
- Test: `src/lib/spark.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spark.test.ts
import { test, expect } from "bun:test";
import { buildSpark } from "./spark";
import type { OhlcBar } from "./types";

const bar = (date: string, c: number): OhlcBar => ({ date, o: c, h: c, l: c, c });

test("returns closes from fromDate forward", () => {
  const ohlc = [bar("2026-01-01", 10), bar("2026-02-01", 20), bar("2026-03-01", 30)];
  expect(buildSpark(ohlc, "2026-02-01")).toEqual([20, 30]);
});

test("includes the bar exactly on fromDate", () => {
  const ohlc = [bar("2026-01-01", 10), bar("2026-01-02", 11)];
  expect(buildSpark(ohlc, "2026-01-01")).toEqual([10, 11]);
});

test("returns empty when no bars on/after fromDate", () => {
  expect(buildSpark([bar("2026-01-01", 10)], "2027-01-01")).toEqual([]);
});

test("downsamples to maxPoints, keeping first and last", () => {
  const ohlc = Array.from({ length: 100 }, (_, i) => bar(`2026-01-${i + 1}`, i));
  const spark = buildSpark(ohlc, "2026-01-1", 24);
  expect(spark.length).toBe(24);
  expect(spark[0]).toBe(0);
  expect(spark[spark.length - 1]).toBe(99);
});

test("does not downsample when already at or under maxPoints", () => {
  const ohlc = [bar("2026-01-01", 1), bar("2026-01-02", 2), bar("2026-01-03", 3)];
  expect(buildSpark(ohlc, "2026-01-01", 24)).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/spark.test.ts`
Expected: FAIL — `Cannot find module './spark'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/spark.ts
import type { OhlcBar } from "./types";

// Downsampled close-price series from `fromDate` forward, for a mini sparkline.
// Baked into each Call at score time so the dashboard needs no per-ticker OHLC.
// Always keeps the first and last point; evenly samples the middle.
export function buildSpark(ohlc: OhlcBar[], fromDate: string, maxPoints = 24): number[] {
  const closes = ohlc.filter((b) => b.date >= fromDate).map((b) => b.c);
  if (closes.length <= maxPoints) return closes;
  const step = (closes.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => closes[Math.round(i * step)]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/spark.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark.ts src/lib/spark.test.ts
git commit -m "feat(data): add buildSpark — downsampled sparkline series helper"
```

---

### Task 2: `mergePrices` helper

**Files:**
- Create: `src/lib/prices-merge.ts`
- Test: `src/lib/prices-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prices-merge.test.ts
import { test, expect } from "bun:test";
import { mergePrices } from "./prices-merge";
import type { OhlcBar } from "./types";

const bar = (date: string, c: number): OhlcBar => ({ date, o: c, h: c, l: c, c });

test("unions by date and sorts ascending", () => {
  const a = [bar("2026-01-03", 3), bar("2026-01-01", 1)];
  const b = [bar("2026-01-02", 2)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 1), bar("2026-01-02", 2), bar("2026-01-03", 3)]);
});

test("incoming overrides existing for the same date", () => {
  const a = [bar("2026-01-01", 1)];
  const b = [bar("2026-01-01", 999)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 999)]);
});

test("handles empty inputs", () => {
  expect(mergePrices([], [bar("2026-01-01", 1)])).toEqual([bar("2026-01-01", 1)]);
  expect(mergePrices([bar("2026-01-01", 1)], [])).toEqual([bar("2026-01-01", 1)]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/prices-merge.test.ts`
Expected: FAIL — `Cannot find module './prices-merge'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/prices-merge.ts
import type { OhlcBar } from "./types";

// Union two daily-OHLC series by date (incoming wins on collision), sorted ascending.
// Used to dedupe per-ticker prices into one shared store across creators.
export function mergePrices(existing: OhlcBar[], incoming: OhlcBar[]): OhlcBar[] {
  const byDate = new Map<string, OhlcBar>();
  for (const b of existing) byDate.set(b.date, b);
  for (const b of incoming) byDate.set(b.date, b);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/prices-merge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prices-merge.ts src/lib/prices-merge.test.ts
git commit -m "feat(data): add mergePrices — union-by-date OHLC merge"
```

---

### Task 3: Types + schema — drop `tickers`, add `spark`, add `PriceFileSchema`

**Files:**
- Modify: `src/lib/types.ts:6-44`
- Modify: `src/lib/schema.ts`
- Test: `src/lib/schema.test.ts`

- [ ] **Step 1: Update the schema test (failing) to the slim shape**

Replace the entire contents of `src/lib/schema.test.ts` with:

```ts
import { test, expect } from "bun:test";
import { DatasetSchema, PriceFileSchema } from "./schema";

const valid = {
  creator: { handle: "kevvonz", name: "Kevin Hu" },
  generatedAt: "2026-06-02",
  spyAnchor: "SPY",
  calls: [{
    shortcode: "DZDmQutB0Ep", postDate: "2026-06-01", ticker: "NBIS",
    company: "Nebius Group N.V.", isFirstCall: true, conviction: 0.9,
    quote: "buy right here", onScreenPrice: 273.01, spark: [273.01, 280.5, 291.2],
    returns: { "1w": { stock: null, spy: null, excess: null },
               "1m": { stock: null, spy: null, excess: null },
               "3m": { stock: null, spy: null, excess: null },
               "toDate": { stock: 0.1, spy: 0.05, excess: 0.05 } },
  }],
  scorecard: { totalCalls: 1, uniqueTickers: 1, hitRate: { "1m": 0, "3m": 0 },
    hitRateN: { "1m": 0, "3m": 0 },
    avgExcess: { "1w": 0, "1m": 0, "3m": 0, "toDate": 0.05 },
    callsPerWeek: 0.5, best: [], worst: [] },
  caveats: ["survivorship"],
};

test("accepts a valid slim dataset", () => {
  expect(() => DatasetSchema.parse(valid)).not.toThrow();
});

test("accepts a call without spark (optional)", () => {
  const noSpark = structuredClone(valid);
  delete (noSpark.calls[0] as { spark?: number[] }).spark;
  expect(() => DatasetSchema.parse(noSpark)).not.toThrow();
});

test("rejects a call missing ticker", () => {
  const bad = structuredClone(valid);
  // @ts-expect-error intentional
  delete bad.calls[0].ticker;
  expect(() => DatasetSchema.parse(bad)).toThrow();
});

test("PriceFileSchema accepts an OHLC array", () => {
  expect(() => PriceFileSchema.parse([{ date: "2026-06-01", o: 1, h: 2, l: 1, c: 2 }])).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/schema.test.ts`
Expected: FAIL — `PriceFileSchema` is not exported / undefined.

- [ ] **Step 3: Update `src/lib/schema.ts`**

Replace the entire contents with:

```ts
import { z } from "zod";

const ReturnTriple = z.object({
  stock: z.number().nullable(),
  spy: z.number().nullable(),
  excess: z.number().nullable(),
});

const OhlcBarSchema = z.object({
  date: z.string(), o: z.number(), h: z.number(), l: z.number(), c: z.number(),
});

export const PriceFileSchema = z.array(OhlcBarSchema);

const CallSchema = z.object({
  shortcode: z.string(),
  postDate: z.string(),
  ticker: z.string(),
  company: z.string(),
  isFirstCall: z.boolean(),
  conviction: z.number().min(0).max(1),
  quote: z.string(),
  summary: z.string().optional(),
  onScreenPrice: z.number().nullable().optional(),
  spark: z.array(z.number()).optional(),
  returns: z.object({
    "1w": ReturnTriple, "1m": ReturnTriple, "3m": ReturnTriple, "toDate": ReturnTriple,
  }),
});

export const DatasetSchema = z.object({
  creator: z.object({ handle: z.string(), name: z.string() }),
  generatedAt: z.string(),
  spyAnchor: z.string(),
  calls: z.array(CallSchema),
  scorecard: z.object({
    totalCalls: z.number(), uniqueTickers: z.number(),
    hitRate: z.object({ "1m": z.number(), "3m": z.number() }),
    hitRateN: z.object({ "1m": z.number(), "3m": z.number() }),
    avgExcess: z.object({ "1w": z.number(), "1m": z.number(), "3m": z.number(), "toDate": z.number() }),
    callsPerWeek: z.number(), best: z.array(CallSchema), worst: z.array(CallSchema),
    funnel: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
  }),
  caveats: z.array(z.string()),
});
```

- [ ] **Step 4: Update `src/lib/types.ts`**

In `src/lib/types.ts`, add `spark` to the `Call` interface (after the `onScreenPrice` line, before `returns`):

```ts
  onScreenPrice?: number | null;
  spark?: number[];            // downsampled closes from postDate forward, for the sparkline
  returns: Record<Horizon, ReturnTriple>;
```

And remove the `tickers` line from the `Dataset` interface. The `Dataset` interface must become exactly:

```ts
export interface Dataset {
  creator: { handle: string; name: string };
  generatedAt: string;
  spyAnchor: string;
  calls: Call[];
  scorecard: Scorecard;
  caveats: string[];
}
```

- [ ] **Step 5: Run test + typecheck to verify**

Run: `bun test src/lib/schema.test.ts && bunx tsc --noEmit`
Expected: schema tests PASS (4). `tsc` will now report errors in `score.ts` and the two routes (they still reference `tickers`) — that is expected and fixed in Tasks 4, 6, 7. Confirm the ONLY `tsc` errors are about `tickers` in those three files; no errors in `schema.ts`/`types.ts`/`spark.ts`/`prices-merge.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schema.ts src/lib/schema.test.ts src/lib/types.ts
git commit -m "feat(data): slim Dataset schema — drop tickers, add spark + PriceFileSchema"
```

---

### Task 4: `score.ts` — bake spark, write shared prices, stop emitting tickers

**Files:**
- Modify: `pipeline/score.ts`
- Test: `pipeline/score.test.ts`

- [ ] **Step 1: Update `pipeline/score.test.ts` (failing)**

Replace the final three assertions block. The test body's assertions become:

```ts
  const ds = assembleDataset({ handle: "kevvonz", name: "Kevin Hu" },
    reelCalls, { NBIS: nbis, SPY: spy }, "2026-06-09");
  expect(ds.calls[0].isFirstCall).toBe(true);
  expect(ds.calls[0].returns["1w"].excess).toBeCloseTo(0.10, 6);
  expect(ds.scorecard.totalCalls).toBe(1);
  expect(ds.calls[0].spark).toEqual([100, 110]);
  expect((ds as unknown as { tickers?: unknown }).tickers).toBeUndefined();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test pipeline/score.test.ts`
Expected: FAIL — `ds.calls[0].spark` is `undefined` and `tickers` is still present.

- [ ] **Step 3: Update `assembleDataset` in `pipeline/score.ts`**

Add the import near the top (after the existing scorecard import on line 6):

```ts
import { buildSpark } from "../src/lib/spark";
import { mergePrices } from "../src/lib/prices-merge";
```

Add `ROOT` to the config import on line 4:

```ts
import { creatorDir, pricesDir, DATA, ROOT } from "./config";
```

In `assembleDataset`, bake `spark` into each call by adding the field to the mapped object (extend the existing `calls` map at lines 22-26):

```ts
  let calls: Call[] = bullish.map(c => ({
    shortcode: c.shortcode, postDate: c.postDate, ticker: c.ticker, company: c.company,
    isFirstCall: false, conviction: c.conviction, quote: c.quote, summary: c.summary, onScreenPrice: c.onScreenPrice,
    spark: buildSpark(ohlc[c.ticker] ?? [], c.postDate),
    returns: computeReturns(ohlc[c.ticker] ?? [], spy, c.postDate),
  }));
```

Delete the two `tickers` lines (old lines 33-34):

```ts
  const tickers: Record<string, { ohlc: OhlcBar[] }> = {};
  for (const t of [...new Set(calls.map(c => c.ticker)), "SPY"]) tickers[t] = { ohlc: ohlc[t] ?? [] };
```

And remove `tickers` from the returned object so it reads:

```ts
  const ds: Dataset = {
    creator, generatedAt, spyAnchor: "SPY", calls,
    scorecard: { ...buildScorecard(calls), funnel }, caveats: CAVEATS,
  };
```

- [ ] **Step 4: Write shared price files in `score()`**

In `score()`, after the dataset is written (`await writeFile(... "dataset.json" ...)` on line 53) and before `await updateIndex(...)`, add:

```ts
  // Write deduped per-ticker prices to a shared store (one file per symbol across
  // all creators) for the ticker-page fallback. Merge so a creator with a shorter
  // history never truncates another's bars.
  const sharedDir = join(ROOT, "data", "prices");
  await mkdir(sharedDir, { recursive: true });
  for (const sym of new Set([...ds.calls.map(c => c.ticker), "SPY"])) {
    const bars = ohlc[sym] ?? [];
    if (!bars.length) continue;
    const f = join(sharedDir, `${sym}.json`);
    const existing: OhlcBar[] = existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : [];
    await writeFile(f, JSON.stringify(mergePrices(existing, bars)));
  }
```

(`mkdir`, `existsSync`, `readFile`, `writeFile`, `join`, `OhlcBar` are all already imported in this file.)

- [ ] **Step 5: Run test + typecheck**

Run: `bun test pipeline/score.test.ts && bunx tsc --noEmit`
Expected: `score.test.ts` PASS. `tsc` errors now remain ONLY in the two route files (`tickers`), fixed next.

- [ ] **Step 6: Commit**

```bash
git add pipeline/score.ts pipeline/score.test.ts
git commit -m "feat(pipeline): bake spark per call, write shared deduped price store, drop tickers from dataset"
```

---

### Task 5: `fetchPrices` in `data.ts`

**Files:**
- Modify: `src/lib/data.ts`

- [ ] **Step 1: Add the function**

Append to `src/lib/data.ts` (it already imports `DatasetSchema` and `siteUrl`; add `PriceFileSchema` to the schema import):

Change the schema import line to:

```ts
import { DatasetSchema, PriceFileSchema } from "./schema";
```

Add `OhlcBar` to the types import:

```ts
import type { Dataset, OhlcBar } from "./types";
```

Append at the end of the file:

```ts
// Shared per-ticker baked OHLC, served as a static asset (public/prices/<symbol>.json).
// Used only as the ticker-page fallback when the live Yahoo fetch errors. Returns []
// when the file is absent so the caller degrades to "no fallback data" gracefully.
export async function fetchPrices(symbol: string): Promise<OhlcBar[]> {
  const path = `/prices/${symbol}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) return [];
  return PriceFileSchema.parse(await res.json());
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no NEW errors in `data.ts` (route `tickers` errors still present until Tasks 6-7).

- [ ] **Step 3: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat(data): add fetchPrices for the shared per-ticker price store"
```

---

### Task 6: Creator page — sparkline from baked `spark`

**Files:**
- Modify: `src/components/Sparkline.tsx`
- Modify: `src/routes/c.$handle.index.tsx:25,272-321,395-431`

- [ ] **Step 1: Change `Sparkline` to take closes directly**

Replace the entire contents of `src/components/Sparkline.tsx` with:

```tsx
// Mini stock-path sparkline from a baked close series, dot at the first point.
// Colored by the call's to-date excess sign.
export function Sparkline({
  closes,
  excess,
  width = 64,
  height = 20,
}: {
  closes: number[];
  excess: number | null;
  width?: number;
  height?: number;
}) {
  if (closes.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = closes.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color =
    excess == null ? "var(--muted-foreground)" : excess >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={x(0)} cy={y(closes[0])} r={2} fill={color} />
    </svg>
  );
}
```

- [ ] **Step 2: Update `c.$handle.index.tsx` imports**

On line 25, remove `OhlcBar` from the types import (it becomes unused after this task):

```ts
import type { Call, Dataset } from "../lib/types";
```

- [ ] **Step 3: Stop passing OHLC bars to `CallRow`**

In `CallsList` (around lines 298-305), change the `CallRow` render to drop the `bars` prop:

```tsx
        {visible.map((c) => (
          <CallRow
            key={c.shortcode}
            handle={handle}
            call={c}
          />
        ))}
```

- [ ] **Step 4: Update the `CallRow` signature and Sparkline usage**

Change the `CallRow` declaration (line 395) from `{ handle, call, bars }: { handle: string; call: Call; bars: OhlcBar[] }` to:

```tsx
function CallRow({ handle, call }: { handle: string; call: Call }) {
```

And change the Sparkline usage (line 430) to:

```tsx
          <Sparkline closes={call.spark ?? []} excess={call.returns.toDate.excess} />
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors in `c.$handle.index.tsx` or `Sparkline.tsx`. Only `c.$handle.ticker.$symbol.tsx` errors remain (fixed in Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/components/Sparkline.tsx src/routes/c.\$handle.index.tsx
git commit -m "feat(ui): creator-page sparklines from baked spark series (no OHLC payload)"
```

---

### Task 7: Ticker page — fallback from fetched price files

**Files:**
- Modify: `src/routes/c.$handle.ticker.$symbol.tsx:30,38-65,90-119`

- [ ] **Step 1: Update imports**

Change the data import (line 4) to include `fetchPrices`:

```ts
import { fetchDataset, fetchPrices } from "../lib/data";
```

- [ ] **Step 2: Replace the loader**

Replace the current `loader` (the `async ({ params, context }) => { … }` block, including the interim hotfix that spread `...ds` with a slimmed `tickers`) with:

```ts
  loader: async ({ params, context }) => {
    const ds = await fetchDataset(params.handle);
    const firstDate = firstDateOf(ds.calls);
    // Prefetch the default timeframe (SSR first paint) and the baked fallback prices
    // for this symbol + SPY in parallel — no request waterfall. The shared price
    // store replaces the old per-dataset tickers map (which dehydrated ~5 MB into HTML).
    const [, bakedOhlc, bakedSpy] = await Promise.all([
      context.queryClient.ensureQueryData(chartQuery(params.symbol, "1Y", firstDate)),
      fetchPrices(params.symbol),
      fetchPrices("SPY"),
    ]);
    return { ...ds, bakedOhlc, bakedSpy };
  },
```

- [ ] **Step 3: Replace the baked-OHLC derivation in the component**

In `TickerPage`, replace the `bakedOhlc`/`bakedSpy` blocks (current lines 100-115, which read `ds.tickers[…]`) with reads from the loader data:

```ts
  // Baked daily OHLC from the shared price store — used as the fallback when the
  // live Yahoo fetch errors or returns nothing. (OhlcBar and LiveBar share a shape.)
  const { bakedOhlc, bakedSpy } = Route.useLoaderData();
```

Note: `ds` is still obtained via `const ds = Route.useLoaderData();` on line 91 — keep that line; it now also carries `bakedOhlc`/`bakedSpy`. Remove the two `const bakedOhlc: LiveBar[] = …` / `const bakedSpy: LiveBar[] = …` mapping blocks entirely. The downstream `usingFallback ? bakedOhlc : …` logic is unchanged because `OhlcBar` (`{date,o,h,l,c}`) is structurally identical to `LiveBar`.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS — zero errors across the whole project.

- [ ] **Step 5: Run the full test suite**

Run: `bun test`
Expected: all tests PASS (including the new `spark`/`prices-merge` suites and updated `score`/`schema`).

- [ ] **Step 6: Commit**

```bash
git add src/routes/c.\$handle.ticker.\$symbol.tsx
git commit -m "feat(ui): ticker fallback from shared price store; remove interim tickers slimming"
```

---

### Task 8: `prebuild.ts` — copy shared prices to `public/`

**Files:**
- Modify: `scripts/prebuild.ts:12,55-59,105-107`
- Modify: `.gitignore`

- [ ] **Step 1: Import `existsSync`**

Change the `node:fs` import on line 12 to include `existsSync`:

```ts
import { mkdirSync, rmSync, writeFileSync, readFileSync, cpSync, existsSync } from "node:fs";
```

- [ ] **Step 2: Add the prices dirs and copy step**

After the `DS_DIR` constant (line 21), add:

```ts
const PRICES_SRC = join(ROOT, "data", "prices");
const PRICES_DST = join(PUB, "prices");
```

In `main()`, alongside the existing `rmSync`/`mkdirSync` for `DS_DIR` (lines 56-59), add the prices output reset:

```ts
  rmSync(PRICES_DST, { recursive: true, force: true });
  mkdirSync(PRICES_DST, { recursive: true });
```

Then after the per-creator dataset-copy loop completes (after the `await pool(...)` on line 103), add:

```ts
  if (existsSync(PRICES_SRC)) cpSync(PRICES_SRC, PRICES_DST, { recursive: true });
```

- [ ] **Step 3: Ignore generated `public/prices/`**

In `.gitignore`, add a line next to the existing `public/datasets/` entry (line 33):

```
public/datasets/
public/prices/
```

- [ ] **Step 4: Verify prebuild runs and emits prices**

Run: `bun run scripts/prebuild.ts`
Expected: completes; `public/prices/` is populated. Verify:

```bash
ls public/prices | head && echo "files: $(ls public/prices | wc -l)"
```

Expected: per-ticker `<SYMBOL>.json` files (one per unique called ticker + `SPY.json`).

- [ ] **Step 5: Commit**

```bash
git add scripts/prebuild.ts .gitignore
git commit -m "build: copy shared price store to public/prices at prebuild"
```

---

### Task 9: Migrate existing datasets + verify payload

**Files:**
- Create: `scripts/migrate-split-prices.ts`

This restructures the already-committed `dataset.json` files in place (which still contain `tickers`) into the new slim shape + shared price store — without re-running the scoring pipeline, so `generatedAt`, returns, and funnel labels are preserved exactly.

- [ ] **Step 1: Write the migration script**

```ts
// scripts/migrate-split-prices.ts
// One-time: restructure existing committed dataset.json files into the slim shape
// (drop `tickers`, bake `spark` per call) and write the shared deduped price store.
// Reads the OLD fat dataset via raw JSON.parse (not the new schema), so it is
// unaffected by the schema change. Idempotent: safe to re-run.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildSpark } from "../src/lib/spark";
import { mergePrices } from "../src/lib/prices-merge";
import type { OhlcBar } from "../src/lib/types";

const DATA = join(import.meta.dir, "..", "data", "creators");
const SHARED = join(import.meta.dir, "..", "data", "prices");
mkdirSync(SHARED, { recursive: true });

const index: { handle: string }[] = JSON.parse(readFileSync(join(DATA, "index.json"), "utf8"));
for (const e of index) {
  const p = join(DATA, e.handle, "dataset.json");
  const ds = JSON.parse(readFileSync(p, "utf8"));
  const tickers: Record<string, { ohlc: OhlcBar[] }> = ds.tickers ?? {};

  for (const c of ds.calls) {
    c.spark = buildSpark(tickers[c.ticker]?.ohlc ?? [], c.postDate);
  }
  for (const [sym, t] of Object.entries(tickers)) {
    const f = join(SHARED, `${sym}.json`);
    const existing: OhlcBar[] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
    writeFileSync(f, JSON.stringify(mergePrices(existing, t.ohlc)));
  }
  delete ds.tickers;
  writeFileSync(p, JSON.stringify(ds, null, 2));
  console.log(`migrated ${e.handle}: ${ds.calls.length} calls, ${Object.keys(tickers).length} tickers`);
}
```

- [ ] **Step 2: Run the migration**

Run: `bun run scripts/migrate-split-prices.ts`
Expected: one line per creator, e.g. `migrated TheProfInvestor: 880 calls, 212 tickers`.

- [ ] **Step 3: Verify the slim dataset is small and schema-valid**

```bash
ls -lah data/creators/*/dataset.json
ls data/prices | wc -l
bun -e 'import { DatasetSchema } from "./src/lib/schema"; import { readFileSync } from "node:fs"; for (const h of ["kevvonz","TheProfInvestor"]) { DatasetSchema.parse(JSON.parse(readFileSync(`data/creators/${h}/dataset.json`,"utf8"))); console.log(h,"valid",(readFileSync(`data/creators/${h}/dataset.json`).length/1e6).toFixed(2),"MB"); }'
```

Expected: each `dataset.json` is now well under 1 MB (was 9.5 MB for TheProfInvestor); `data/prices` holds the deduped per-ticker files; both datasets parse against the slim `DatasetSchema`.

- [ ] **Step 4: Full typecheck + tests**

Run: `bunx tsc --noEmit && bun test`
Expected: zero type errors; all tests pass.

- [ ] **Step 5: End-to-end payload check (build + serve)**

```bash
bun run scripts/prebuild.ts
ls -lah public/datasets/*.json
```

Expected: each `public/datasets/<h>.json` < 1 MB; `public/prices/` populated.

Optional definitive HTML check (heavier — starts the app): run the build and a preview server, then:

```bash
curl -s -o /dev/null -w "ticker HTML: %{size_download} bytes\n" http://localhost:3000/c/TheProfInvestor/ticker/PLTR
```

Expected: well under the previous 6,071,464 bytes (target <1 MB).

- [ ] **Step 6: Commit the regenerated data**

```bash
git add scripts/migrate-split-prices.ts data/creators/*/dataset.json data/creators/index.json data/prices
git commit -m "chore(data): migrate datasets to slim shape + shared price store"
```

---

## Notes for later phases (NOT in scope here)

- **Phase 2 (Blob):** point `fetchDataset`/`fetchPrices` at Vercel Blob URLs with short TTL so data updates without a redeploy; write artifacts to versioned paths + a pointer file to avoid the ~60 s overwrite-propagation lag.
- **Phase 3 (ingestion):** run the IG headful Playwright scraper + X ingest + daily return recompute on `imos-vm` (private, Tailscale) via cron; push artifacts outbound to Blob. No public traffic to the VM.
- **No database, no PocketBase:** there is no login and no per-request query, so scoring data stays static on the CDN.
- **`data/prices/` is committed** (tracked by default — not under the `data/creators/*` ignore). It is the build-time source for `public/prices/`.

## Self-Review

- **Spec coverage:** granularity split (Tasks 3,4,6,7), price dedup/shared store (Tasks 2,4,8), sparkline baking (Tasks 1,4,6), ticker fallback (Tasks 5,7), migration of existing data (Task 9), build wiring (Task 8). All covered.
- **Type consistency:** `buildSpark(ohlc, fromDate, maxPoints?)`, `mergePrices(existing, incoming)`, `fetchPrices(symbol)`, `Call.spark?: number[]`, `Sparkline({ closes, excess })`, loader returns `{ ...ds, bakedOhlc, bakedSpy }` — names consistent across Tasks 1-9.
- **Placeholder scan:** every code step contains full code; no TBD/TODO.
- **Ordering:** schema (3) precedes score (4) so `DatasetSchema.parse` in `assembleDataset` accepts the slim shape; routes (6,7) follow the type change; migration (9) last, reading raw JSON so it is immune to the schema change.
