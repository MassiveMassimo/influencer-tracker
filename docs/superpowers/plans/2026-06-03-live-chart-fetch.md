# Live Chart Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch ticker-chart OHLC live from Yahoo (intraday density for short timeframes) via a TanStack Start server function + TanStack Query, while scoring stays frozen in `dataset.json`.

**Architecture:** A server function `fetchChart` calls `yahoo-finance2` server-side (no CORS, no key), picking the interval per timeframe by the retail-app standard (intraday ≤60d, daily beyond). A `queryOptions` factory feeds both an SSR loader prefetch and a `useQuery` in the ticker component. On Yahoo error the chart falls back to the baked daily OHLC already in the loader. The just-built zoom/scroll-pan is removed — each timeframe tab is its own native-density window.

**Tech Stack:** TanStack Start 1.168, TanStack Router 1.170, TanStack Query 5.100, `@tanstack/react-router-ssr-query` 1.167, `yahoo-finance2` 3.15, Zod, Bun test.

**Spec:** `docs/superpowers/specs/2026-06-03-live-chart-fetch-design.md`

**Conventions:** `bun test` (NOT vitest), `bunx tsc --noEmit` to typecheck, `#/` alias → `src/`. Run all commands from `influencer-tracker/`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/lib/chart-window.ts` | Pure: `Timeframe` → Yahoo `{ interval, period1 }` | Create |
| `src/lib/chart-window.test.ts` | Tests for the mapping | Create |
| `src/lib/chart-fetch.ts` | `fetchChart` server fn, `LiveBar` type, `toLiveBars`, TTL cache helpers | Create |
| `src/lib/chart-fetch.test.ts` | Tests for `toLiveBars` + cache helpers (no network) | Create |
| `src/lib/chart-query.ts` | `chartQuery` queryOptions factory | Create |
| `src/lib/chart-query.test.ts` | Tests for queryKey/staleTime shape | Create |
| `src/router.tsx` | Add `QueryClient` + `setupRouterSsrQueryIntegration` | Modify |
| `src/routes/__root.tsx` | `createRootRoute` → `createRootRouteWithContext<{ queryClient }>` | Modify |
| `src/routes/c.$handle.ticker.$symbol.tsx` | Consume `useQuery`; drop zoom/scroll; skeleton + baked fallback | Modify |
| `influencer-tracker/CLAUDE.md` | Document live-fetch path | Modify |
| `package.json` | Add `@tanstack/react-query` direct dep | Modify (via `bun add`) |

---

## Task 1: Add TanStack Query dependency and wire QueryClient into the router

**Files:**
- Modify: `package.json` (via `bun add`)
- Modify: `src/router.tsx`
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Add the direct dependency**

Run:
```bash
bun add @tanstack/react-query
```
Expected: `package.json` gains `"@tanstack/react-query"` under dependencies (it is already pinned transitively at 5.100.14 in `bun.lock`).

- [ ] **Step 2: Wire QueryClient into the router**

Replace the entire contents of `src/router.tsx` with:

```tsx
import { QueryClient } from '@tanstack/react-query'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000 },
    },
  })

  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

- [ ] **Step 3: Give the root route a typed context**

In `src/routes/__root.tsx`, change the import on line 1-6 from `createRootRoute` to `createRootRouteWithContext`, and add a `QueryClient` type import. Replace:

```tsx
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
```

with:

```tsx
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
```

Then change line 18 from:

```tsx
export const Route = createRootRoute({
```

to:

```tsx
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
```

(Everything else in `__root.tsx` — the `loader: () => listCreators()`, `head`, `component`, `shellComponent` — stays unchanged.)

- [ ] **Step 4: Typecheck**

Run:
```bash
bunx tsc --noEmit
```
Expected: PASS (no errors). If `routeTree.gen.ts` complains about context, run `bun run dev` once to regenerate it, then re-run tsc.

- [ ] **Step 5: Smoke-test the boot**

Run:
```bash
bun run dev
```
Expected: server starts on :3000 with no console errors. Open `http://localhost:3000`, confirm the home page renders. Stop the server (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/router.tsx src/routes/__root.tsx
git commit -m "feat(charts): wire TanStack Query QueryClient into the router"
```

---

## Task 2: `chartWindow` — timeframe → Yahoo interval/range mapping

**Files:**
- Create: `src/lib/chart-window.ts`
- Test: `src/lib/chart-window.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/chart-window.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { chartWindow } from "./chart-window.ts";

const NOW = new Date("2026-06-03T12:00:00Z"); // a Wednesday
const SATURDAY = new Date("2026-06-06T12:00:00Z");
const FIRST = new Date("2025-06-03T00:00:00Z"); // ~1y of history

describe("chartWindow", () => {
  it("uses 5m for 1D, anchored to that trading day", () => {
    const w = chartWindow("1D", { now: NOW, firstDate: FIRST });
    expect(w.interval).toBe("5m");
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-06-03");
  });

  it("1D on a weekend steps back to the last weekday", () => {
    const w = chartWindow("1D", { now: SATURDAY, firstDate: FIRST });
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-06-05"); // Friday
  });

  it("uses 30m for 1W (7 days back)", () => {
    const w = chartWindow("1W", { now: NOW, firstDate: FIRST });
    expect(w.interval).toBe("30m");
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-05-27");
  });

  it("uses 1h for 1M (30 days back)", () => {
    const w = chartWindow("1M", { now: NOW, firstDate: FIRST });
    expect(w.interval).toBe("1h");
    expect(w.period1.toISOString().slice(0, 10)).toBe("2026-05-04");
  });

  it("uses daily for 3M/6M/1Y", () => {
    for (const tf of ["3M", "6M", "1Y"] as const) {
      expect(chartWindow(tf, { now: NOW, firstDate: FIRST }).interval).toBe("1d");
    }
  });

  it("intraday intervals only appear for windows that fit Yahoo's 60-day cap", () => {
    const intraday = new Set(["5m", "30m", "1h"]);
    for (const tf of ["1D", "1W", "1M"] as const) {
      expect(intraday.has(chartWindow(tf, { now: NOW, firstDate: FIRST }).interval)).toBe(true);
    }
    for (const tf of ["3M", "6M", "1Y", "All"] as const) {
      expect(intraday.has(chartWindow(tf, { now: NOW, firstDate: FIRST }).interval)).toBe(false);
    }
  });

  it("All starts at firstDate; uses 1d under 2y, 1wk beyond", () => {
    const recent = chartWindow("All", { now: NOW, firstDate: FIRST });
    expect(recent.interval).toBe("1d");
    expect(recent.period1.toISOString().slice(0, 10)).toBe("2025-06-03");

    const old = chartWindow("All", { now: NOW, firstDate: new Date("2022-01-01T00:00:00Z") });
    expect(old.interval).toBe("1wk");
    expect(old.period1.toISOString().slice(0, 10)).toBe("2022-01-01");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
bun test src/lib/chart-window.test.ts
```
Expected: FAIL — `Cannot find module './chart-window.ts'`.

- [ ] **Step 3: Implement `chartWindow`**

Create `src/lib/chart-window.ts`:

```ts
import type { Timeframe } from "./window-series.ts";

// Subset of yahoo-finance2 chart intervals this app uses.
export type LiveInterval = "5m" | "30m" | "1h" | "1d" | "1wk";

export interface ChartWindow {
  interval: LiveInterval;
  period1: Date;
}

const DAY_MS = 86_400_000;

// Step back to the most recent weekday (Yahoo has no weekend bars).
function lastTradingDay(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay(); // 0 Sun, 6 Sat
  if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
  else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

// Maps a timeframe to a Yahoo interval + start date. Intraday intervals are
// restricted to windows within Yahoo's ~60-day sub-daily cap (1D/1W/1M); 3M+
// use daily, matching the retail-app standard (Robinhood/Google Finance).
export function chartWindow(
  tf: Timeframe,
  opts: { now: Date; firstDate: Date },
): ChartWindow {
  const { now, firstDate } = opts;
  switch (tf) {
    case "1D":
      return { interval: "5m", period1: lastTradingDay(now) };
    case "1W":
      return { interval: "30m", period1: daysAgo(now, 7) };
    case "1M":
      return { interval: "1h", period1: daysAgo(now, 30) };
    case "3M":
      return { interval: "1d", period1: daysAgo(now, 90) };
    case "6M":
      return { interval: "1d", period1: daysAgo(now, 180) };
    case "1Y":
      return { interval: "1d", period1: daysAgo(now, 365) };
    case "All": {
      const overTwoYears = now.getTime() - firstDate.getTime() > 2 * 365 * DAY_MS;
      return { interval: overTwoYears ? "1wk" : "1d", period1: firstDate };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
bun test src/lib/chart-window.test.ts
```
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart-window.ts src/lib/chart-window.test.ts
git commit -m "feat(charts): chartWindow maps timeframe to Yahoo interval/range"
```

---

## Task 3: `fetchChart` server function with `LiveBar`, mapping, and TTL cache

**Files:**
- Create: `src/lib/chart-fetch.ts`
- Test: `src/lib/chart-fetch.test.ts`

- [ ] **Step 1: Write the failing tests (pure pieces only — no network)**

Create `src/lib/chart-fetch.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { toLiveBars, cacheGet, cacheSet, type RawQuote } from "./chart-fetch.ts";

describe("toLiveBars", () => {
  it("maps quotes to ISO-datetime bars and drops incomplete rows", () => {
    const quotes: RawQuote[] = [
      { date: new Date("2026-06-03T13:30:00Z"), open: 10, high: 11, low: 9, close: 10.5 },
      { date: new Date("2026-06-03T13:35:00Z"), open: null, high: 11, low: 9, close: 10.5 },
      { date: new Date("2026-06-03T13:40:00Z"), open: 10.5, high: 12, low: 10, close: 11 },
    ];
    const bars = toLiveBars(quotes);
    expect(bars).toEqual([
      { date: "2026-06-03T13:30:00.000Z", o: 10, h: 11, l: 9, c: 10.5 },
      { date: "2026-06-03T13:40:00.000Z", o: 10.5, h: 12, l: 10, c: 11 },
    ]);
  });
});

describe("cache", () => {
  it("returns a fresh entry and expires a stale one", () => {
    const bars = [{ date: "2026-06-03T13:30:00.000Z", o: 1, h: 1, l: 1, c: 1 }];
    const t0 = 1_000_000;
    cacheSet("AAPL:5m", bars, t0);
    expect(cacheGet("AAPL:5m", t0 + 60_000)).toEqual(bars); // 1 min later: fresh
    expect(cacheGet("AAPL:5m", t0 + 6 * 60_000)).toBeNull(); // 6 min later: stale
    expect(cacheGet("MISS:5m", t0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
bun test src/lib/chart-fetch.test.ts
```
Expected: FAIL — `Cannot find module './chart-fetch.ts'`.

- [ ] **Step 3: Implement `chart-fetch.ts`**

Create `src/lib/chart-fetch.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import YahooFinance from "yahoo-finance2";
import { chartWindow } from "./chart-window.ts";
import type { Timeframe } from "./window-series.ts";

// A live OHLC bar. Unlike the dataset's date-only OhlcBar, `date` is a full ISO
// datetime so intraday bars are distinct. Kept separate so DatasetSchema is
// untouched.
export interface LiveBar { date: string; o: number; h: number; l: number; c: number }

export interface ChartData {
  ohlc: LiveBar[];
  spy: LiveBar[];
  interval: string;
  asOf: string;
}

// Shape of a yahoo-finance2 chart quote (only the fields we read).
export interface RawQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export function toLiveBars(quotes: RawQuote[]): LiveBar[] {
  return quotes
    .filter((q) => q.open != null && q.close != null && q.high != null && q.low != null)
    .map((q) => ({
      date: new Date(q.date).toISOString(),
      o: q.open!,
      h: q.high!,
      l: q.low!,
      c: q.close!,
    }));
}

// --- In-memory TTL cache (per server instance) -----------------------------
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; bars: LiveBar[] }>();

export function cacheGet(key: string, now: number): LiveBar[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.bars;
}

export function cacheSet(key: string, bars: LiveBar[], now: number): void {
  cache.set(key, { at: now, bars });
}

// --- Yahoo fetch ------------------------------------------------------------
const yahoo = new YahooFinance();

async function fetchSymbol(symbol: string, interval: ReturnType<typeof chartWindow>["interval"], period1: Date): Promise<LiveBar[]> {
  const key = `${symbol}:${interval}`;
  const cached = cacheGet(key, Date.now());
  if (cached) return cached;
  const res = await yahoo.chart(symbol, { period1, interval });
  const bars = toLiveBars(res.quotes as RawQuote[]);
  if (bars.length) cacheSet(key, bars, Date.now());
  return bars;
}

const InputSchema = z.object({
  symbol: z.string().min(1).max(12),
  timeframe: z.enum(["1D", "1W", "1M", "3M", "6M", "1Y", "All"]),
  firstDate: z.string(), // ISO date of earliest call, used for the "All" window
});

export const fetchChart = createServerFn({ method: "GET" })
  .inputValidator((data: z.infer<typeof InputSchema>) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ChartData> => {
    const tf = data.timeframe as Timeframe;
    const { interval, period1 } = chartWindow(tf, {
      now: new Date(),
      firstDate: new Date(data.firstDate),
    });
    const [ohlc, spy] = await Promise.all([
      fetchSymbol(data.symbol, interval, period1),
      fetchSymbol("SPY", interval, period1),
    ]);
    return { ohlc, spy, interval, asOf: new Date().toISOString() };
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
bun test src/lib/chart-fetch.test.ts
```
Expected: PASS (2 describes, 2 tests).

- [ ] **Step 5: Typecheck**

Run:
```bash
bunx tsc --noEmit
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chart-fetch.ts src/lib/chart-fetch.test.ts
git commit -m "feat(charts): fetchChart server fn with TTL cache and live-bar mapping"
```

---

## Task 4: `chartQuery` queryOptions factory

**Files:**
- Create: `src/lib/chart-query.ts`
- Test: `src/lib/chart-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/chart-query.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { chartQuery } from "./chart-query.ts";

describe("chartQuery", () => {
  it("keys by symbol + timeframe and sets a 5-minute staleTime", () => {
    const opts = chartQuery("AAPL", "1M", "2025-06-03");
    expect(opts.queryKey).toEqual(["chart", "AAPL", "1M"]);
    expect(opts.staleTime).toBe(5 * 60 * 1000);
    expect(typeof opts.queryFn).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
bun test src/lib/chart-query.test.ts
```
Expected: FAIL — `Cannot find module './chart-query.ts'`.

- [ ] **Step 3: Implement `chart-query.ts`**

Create `src/lib/chart-query.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import type { Timeframe } from "./window-series.ts";
import { fetchChart, type ChartData } from "./chart-fetch.ts";

// Shared by the route loader (ensureQueryData, SSR prefetch) and the component
// (useQuery). Same key + queryFn => SSR data is reused without a refetch.
export function chartQuery(symbol: string, timeframe: Timeframe, firstDate: string) {
  return queryOptions<ChartData>({
    queryKey: ["chart", symbol, timeframe],
    queryFn: () => fetchChart({ data: { symbol, timeframe, firstDate } }),
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
bun test src/lib/chart-query.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chart-query.ts src/lib/chart-query.test.ts
git commit -m "feat(charts): chartQuery queryOptions factory"
```

---

## Task 5: Wire the ticker route to live data; drop zoom/scroll; add skeleton + baked fallback

**Files:**
- Modify: `src/routes/c.$handle.ticker.$symbol.tsx`

This replaces the loaderData-driven OHLC + the zoom/scroll model with `useQuery`. The calls table, markers, ProofViewer, and SEO head are unchanged.

- [ ] **Step 1: Replace the route file**

Replace the entire contents of `src/routes/c.$handle.ticker.$symbol.tsx` with:

```tsx
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDataset } from "../lib/data";
import { ProofViewer } from "#/components/proof-viewer.tsx";
import type { Call } from "#/lib/types.ts";
import { CandlestickChart } from "#/components/charts/candlestick-chart.tsx";
import { Candlestick } from "#/components/charts/candlestick.tsx";
import { LineChart, Line } from "#/components/charts/line-chart.tsx";
import { Grid } from "#/components/charts/grid.tsx";
import { XAxis } from "#/components/charts/x-axis.tsx";
import { ChartTooltip } from "#/components/charts/tooltip/chart-tooltip.tsx";
import {
  ChartMarkers,
  type ChartMarker,
} from "#/components/charts/markers/index.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table.tsx";
import { ChartBoundary } from "../components/ChartBoundary";
import { TimeframeTabs } from "#/components/TimeframeTabs.tsx";
import type { Timeframe } from "#/lib/window-series.ts";
import { chartQuery } from "#/lib/chart-query.ts";
import type { LiveBar } from "#/lib/chart-fetch.ts";
import { siteUrl } from "#/og/site.ts";

// Earliest call date, used as the "All" window start and passed to fetchChart.
function firstDateOf(calls: { postDate: string }[]): string {
  if (!calls.length) return new Date().toISOString().slice(0, 10);
  return calls.reduce((m, c) => (c.postDate < m ? c.postDate : m), calls[0].postDate);
}

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: async ({ params, context }) => {
    const ds = await getDataset({ data: params.handle });
    const firstDate = firstDateOf(ds.calls);
    // Prefetch the default timeframe so the first paint is SSR'd, no spinner.
    await context.queryClient.ensureQueryData(
      chartQuery(params.symbol, "1Y", firstDate),
    );
    return ds;
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.creator.name ?? params.handle;
    const img = siteUrl(`/og/${params.handle}/${params.symbol}`);
    return {
      meta: [
        { title: `${params.symbol} — ${name} · Signal Tracker` },
        { property: "og:title", content: `${params.symbol} — ${name}` },
        {
          property: "og:url",
          content: siteUrl(`/c/${params.handle}/ticker/${params.symbol}`),
        },
        { property: "og:image", content: img },
        { name: "twitter:image", content: img },
      ],
    };
  },
  component: TickerPage,
});

function pct(x: number | null) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

function toneClass(x: number | null) {
  if (x == null) return "text-muted-foreground";
  return x > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : x < 0
      ? "text-rose-600 dark:text-rose-400"
      : "text-muted-foreground";
}

function ChartSkeleton() {
  return (
    <div className="h-[320px] w-full animate-pulse rounded-xl bg-muted/40" />
  );
}

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const calls = ds.calls.filter((c) => c.ticker === symbol);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");

  const firstDate = firstDateOf(ds.calls);
  const query = useQuery(chartQuery(symbol, timeframe, firstDate));

  // Baked daily OHLC from the frozen dataset — used as the fallback when the
  // live Yahoo fetch errors or returns nothing.
  const bakedOhlc: LiveBar[] = (ds.tickers[symbol]?.ohlc ?? []).map((b) => ({
    date: b.date,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
  }));
  const bakedSpy: LiveBar[] = (ds.tickers["SPY"]?.ohlc ?? []).map((b) => ({
    date: b.date,
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
  }));

  const usingFallback = query.isError || (query.data != null && query.data.ohlc.length === 0);
  const ohlc: LiveBar[] = usingFallback ? bakedOhlc : (query.data?.ohlc ?? []);
  const spy: LiveBar[] = usingFallback ? bakedSpy : (query.data?.spy ?? []);

  const callMarkers: ChartMarker[] = calls.map((c) => ({
    date: new Date(c.postDate),
    icon: "▲",
    title: `${symbol} · ${c.postDate}`,
    description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
  }));

  const candles = ohlc.map((b) => ({
    date: new Date(b.date),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));

  // Rebase vs-SPY to the first bar of the fetched range.
  const base = ohlc[0]?.c ?? 1;
  const spyBase = spy[0]?.c ?? 1;
  const spyByDate = new Map(spy.map((b) => [b.date, b.c]));
  const norm = ohlc.map((b) => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
  }));

  const showSkeleton = query.isPending && ohlc.length === 0;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Ticker · @{ds.creator.handle}
        </div>
        <h1 className="mt-1 flex items-baseline gap-2 font-heading text-2xl">
          {symbol}
          <span className="text-base text-muted-foreground">{calls[0]?.company}</span>
        </h1>
      </header>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
            Price
            {usingFallback ? (
              <span className="ml-2 text-amber-600 dark:text-amber-400">· cached daily data</span>
            ) : null}
          </div>
          <TimeframeTabs value={timeframe} onChange={setTimeframe} />
        </div>
        {showSkeleton ? (
          <ChartSkeleton />
        ) : (
          <ChartBoundary>
            <CandlestickChart data={candles} style={{ height: 320 }} revealSignature={timeframe}>
              <Grid horizontal />
              <Candlestick fadedOpacity={0.25} />
              <ChartMarkers items={callMarkers} />
              <XAxis />
              <ChartTooltip />
            </CandlestickChart>
          </ChartBoundary>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background p-6">
        <div className="mb-4 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Stock vs SPY · rebased to 100 · markers are call dates
        </div>
        {showSkeleton ? (
          <ChartSkeleton />
        ) : (
          <ChartBoundary>
            <LineChart data={norm} revealSignature={timeframe} className="h-[320px]">
              <Grid horizontal highlightRowValues={[100]} />
              <Line dataKey="stock" />
              <Line dataKey="spy" stroke="var(--chart-3)" />
              <ChartMarkers items={callMarkers} />
              <XAxis />
              <ChartTooltip />
            </LineChart>
          </ChartBoundary>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Calls & forward return vs SPY · tap a row for proof
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">1w</TableHead>
              <TableHead className="text-right">1m</TableHead>
              <TableHead className="text-right">3m</TableHead>
              <TableHead className="text-right">To date</TableHead>
              <TableHead>Quote</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c) => (
              <TableRow
                key={c.shortcode}
                onClick={() => setSelectedCall(c)}
                className="cursor-pointer"
              >
                <TableCell className="font-mono tabular-nums">
                  {c.postDate}
                  {c.isFirstCall ? " ★" : ""}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1w"].excess)}`}>
                  {pct(c.returns["1w"].excess)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["1m"].excess)}`}>
                  {pct(c.returns["1m"].excess)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["3m"].excess)}`}>
                  {pct(c.returns["3m"].excess)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(c.returns["toDate"].excess)}`}>
                  {pct(c.returns["toDate"].excess)}
                </TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">{c.quote}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <ProofViewer call={selectedCall} onClose={() => setSelectedCall(null)} />
    </main>
  );
}
```

Note what was removed vs the old file: the `useLayoutEffect`/`useRef`/`zoomMultiplier`/`trackWidth` zoom model, both scroll-sync effects, the `ScrollArea` wrappers, and the `ScrollArea`/`zoomMultiplier` imports. `window-series.ts` is no longer imported here (its `windowSeries`/`zoomMultiplier` remain exported and tested — leave the file as-is).

- [ ] **Step 2: Typecheck**

Run:
```bash
bunx tsc --noEmit
```
Expected: PASS. (If a leftover import of `ScrollArea`, `useRef`, or `zoomMultiplier` is flagged as unused under `noUnusedLocals`, remove it — the replacement above already excludes them.)

- [ ] **Step 3: Manual smoke-test the live fetch**

Run:
```bash
bun run dev
```
Then in the browser:
1. Open a ticker page: `http://localhost:3000/c/<handle>/ticker/<SYMBOL>` (pick a creator from the home page and a ticker from their list).
2. Confirm the price chart renders on load (SSR, no spinner) at 1Y daily.
3. Click **1D** — confirm the candlesticks become dense (intraday 5-min bars), not 1–2 candles. Confirm the vs-SPY chart updates too.
4. Click **1M** — confirm hourly density; re-click **1Y** — confirm it's instant (cached).
5. Confirm call markers still render and tapping a calls-table row still opens ProofViewer.

Stop the server (Ctrl-C).

- [ ] **Step 4: Commit**

```bash
git add src/routes/c.\$handle.ticker.\$symbol.tsx
git commit -m "feat(charts): live per-timeframe OHLC via useQuery, drop zoom/scroll, baked fallback"
```

---

## Task 6: Update CLAUDE.md with the live-fetch architecture

**Files:**
- Modify: `influencer-tracker/CLAUDE.md`

- [ ] **Step 1: Add a section documenting the split**

In `influencer-tracker/CLAUDE.md`, add a new section after the "Proof embeds" section (keep wording consistent with the file's existing terse style):

```markdown
## Chart data: baked for scoring, live for display

Two price paths, deliberately split:

- **Scoring** reads OHLC baked into `dataset.json` at pipeline `score` time
  (`pipeline/prices.ts`, Yahoo daily). Frozen so forward-return accuracy is
  reproducible — never recompute it live.
- **Ticker charts** fetch OHLC live from Yahoo per timeframe via a server
  function (`src/lib/chart-fetch.ts` → `fetchChart`), keyed through TanStack
  Query (`src/lib/chart-query.ts`, `chartQuery`). `src/lib/chart-window.ts`
  maps the timeframe to a Yahoo interval the retail-app way: intraday for
  1D/1W/1M (within Yahoo's ~60-day sub-daily cap), daily for 3M+. The server
  fn caches per `symbol:interval` (~5 min) and runs server-side so
  `yahoo-finance2` and the no-key fetch stay out of the client bundle. On a
  Yahoo error the ticker route falls back to the baked daily OHLC.

`QueryClient` is wired in `src/router.tsx` via `setupRouterSsrQueryIntegration`;
the root route is `createRootRouteWithContext<{ queryClient }>`. The ticker
loader prefetches the default timeframe with `ensureQueryData` for an SSR first
paint.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document baked-for-scoring / live-for-charts price split"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run:
```bash
bun test
```
Expected: PASS, including the new `chart-window`, `chart-fetch`, `chart-query` suites and the existing `window-series`/`schema`/`scorecard`/`returns` suites.

- [ ] **Step 2: Typecheck**

Run:
```bash
bunx tsc --noEmit
```
Expected: PASS, no errors.

- [ ] **Step 3: Confirm the spec is satisfied**

Re-read `docs/superpowers/specs/2026-06-03-live-chart-fetch-design.md` and confirm each decision is implemented: chart-only-live (scoring untouched), fresh-on-load (no polling), Yahoo via server fn, retail-standard intervals, zoom/scroll dropped, baked fallback on error.

---

## Self-Review notes (for the planner)

- **Spec coverage:** server fn (T3) ✓, interval mapping (T2) ✓, QueryClient wiring (T1) ✓, ticker consumption + SSR prefetch (T5) ✓, drop zoom/scroll (T5) ✓, baked fallback (T5) ✓, TTL cache (T3) ✓, tests (T2/T3/T4) ✓, docs (T6) ✓.
- **Type consistency:** `LiveBar` (`{date,o,h,l,c}`) is defined in T3 and consumed in T5; `chartWindow` signature `(tf, {now, firstDate})` is consistent T2→T3; `chartQuery(symbol, timeframe, firstDate)` consistent T4→T5; `fetchChart({ data: {...} })` call shape consistent T3→T4.
- **No placeholders:** every code step shows full code; every run step shows the command + expected result.
