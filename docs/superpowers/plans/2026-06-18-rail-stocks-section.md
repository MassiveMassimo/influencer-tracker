# Rail "Stocks" Section (1D Sparklines) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stocks" list to the workspace rail — top-20 recently-called tickers, each with a colored 1D intraday sparkline — in its own lina scroll area, linking to the ticker-primary page.

**Architecture:** Static list from the root loader (cheap, SSR-immediate); 1D sparklines fetched client-side via one batched, cached server fn hitting Yahoo's multi-symbol v7 spark endpoint. Sparkline component gains a gradient fill + smoothed joints (shared with the call table).

**Tech Stack:** TanStack Start (`createServerFn`, file-based root loader), TanStack Query, `yahoo` no-key fetch, lina `ScrollArea`, custom SVG, `bun test`.

## Global Constraints

- **Prerequisite:** the ticker-primary plan (`2026-06-18-ticker-primary-creator-switcher.md`) must be merged/applied first — rows link to `/t/$symbol/$creator` with `creator="all"`. If that route does not yet exist, this plan's typecheck (Tasks 6–7) will fail on the `Link` target.
- Spec: `docs/superpowers/specs/2026-06-18-rail-stocks-section-design.md` (authoritative).
- Tests on `bun test`; typecheck `bunx tsc --noEmit`. `#/` aliases `src/`.
- **No new runtime dependency.**
- **Top 20** stocks, ordered by last-call date desc.
- **One batched** client request → **one** upstream Yahoo request; 5-min server cache; **fail-open** (missing/malformed symbol omitted, endpoint failure → `{}`).
- Validate every symbol with `isSafeAssetKey` before it touches the Yahoo URL.
- All scroll areas use the lina `ScrollArea` (`#/components/ui/scroll-area.tsx`), `maskColor` matching the surface.
- The rail is global (`__root.tsx`); sparklines must **not** block SSR/first paint.
- Code-comment style: no first-person, sentence case, intent not narration.
- Commit after each task. Branch `ticker-primary` (worktree `../influencer-tracker-ticker-primary`).

---

## File Structure

- `src/lib/rail-stocks.ts` (create) — pure `topStocksByLastCall()`.
- `src/lib/rail-stocks.test.ts` (create).
- `src/lib/spark-parse.ts` (create) — pure `parseSparkResponse()` + `sampleCloses()`.
- `src/lib/spark-parse.test.ts` (create).
- `src/lib/svg-smooth.ts` (create) — pure `smoothPath()`.
- `src/lib/svg-smooth.test.ts` (create).
- `src/components/Sparkline.tsx` (modify) — gradient fill + smoothed joints.
- `src/lib/spark-fetch.ts` (create) — `fetch1DSparks` server fn (uses `parseSparkResponse`).
- `src/lib/spark-query.ts` (create) — `sparks1dQuery()`.
- `src/components/RailStocks.tsx` (create) — the section.
- `src/components/WorkspaceRail.tsx` (modify) — accept `stocks`, render `RailStocks` in its own scroll region; thread through `RailContent`.
- `src/components/MobileNav.tsx` (modify) — accept + forward `stocks`.
- `src/routes/__root.tsx` (modify) — loader returns `{ creators, stocks }`; pass `stocks` down.

---

## Task 1: `topStocksByLastCall` helper

**Files:**

- Create: `src/lib/rail-stocks.ts`
- Test: `src/lib/rail-stocks.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface RailStock {
    symbol: string;
    company: string;
    lastCall: string;
  }
  export function topStocksByLastCall(index: CallIndexEntry[], max?: number): RailStock[];
  ```

  Aggregates `index` per ticker (uppercased), `lastCall` = max `postDate`, `company` from the most-recent entry; sorts by `lastCall` desc then symbol asc; caps at `max` (default 20). Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/rail-stocks.test.ts`:

```ts
import { test, expect } from "bun:test";
import { topStocksByLastCall } from "./rail-stocks";
import type { CallIndexEntry } from "./call-index";

function e(over: Partial<CallIndexEntry> & { shortcode: string }): CallIndexEntry {
  return {
    handle: "alice",
    ticker: "NVDA",
    company: "Nvidia",
    postDate: "2026-05-01",
    isFirstCall: true,
    conviction: 0.5,
    ex3m: 0,
    exToDate: 0,
    stockToDate: 0,
    ...over,
  };
}

test("aggregates by ticker, lastCall = max postDate, sorted desc", () => {
  const rows: CallIndexEntry[] = [
    e({ shortcode: "1", ticker: "NVDA", postDate: "2026-05-01" }),
    e({ shortcode: "2", ticker: "NVDA", postDate: "2026-06-10", company: "Nvidia Corp" }),
    e({ shortcode: "3", ticker: "AMD", postDate: "2026-05-20", company: "AMD" }),
  ];
  const out = topStocksByLastCall(rows);
  expect(out.map((s) => s.symbol)).toEqual(["NVDA", "AMD"]);
  expect(out[0].lastCall).toBe("2026-06-10");
  expect(out[0].company).toBe("Nvidia Corp"); // from the most-recent entry
});

test("uppercases ticker and caps at max", () => {
  const rows: CallIndexEntry[] = [
    e({ shortcode: "a", ticker: "aapl", postDate: "2026-01-01" }),
    e({ shortcode: "b", ticker: "msft", postDate: "2026-02-01" }),
    e({ shortcode: "c", ticker: "googl", postDate: "2026-03-01" }),
  ];
  const out = topStocksByLastCall(rows, 2);
  expect(out.map((s) => s.symbol)).toEqual(["GOOGL", "MSFT"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/rail-stocks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/rail-stocks.ts`:

```ts
import type { CallIndexEntry } from "./call-index";

export interface RailStock {
  symbol: string;
  company: string;
  lastCall: string;
}

// Tickers ordered by most-recent call, for the rail's Stocks list. Company is
// taken from the latest entry (names can drift); ties broken by symbol asc.
export function topStocksByLastCall(index: CallIndexEntry[], max = 20): RailStock[] {
  const byTicker = new Map<string, { lastCall: string; company: string }>();
  for (const r of index) {
    const symbol = r.ticker.toUpperCase();
    const prev = byTicker.get(symbol);
    if (!prev || r.postDate > prev.lastCall) {
      byTicker.set(symbol, { lastCall: r.postDate, company: r.company });
    }
  }
  return [...byTicker.entries()]
    .map(([symbol, v]) => ({ symbol, company: v.company, lastCall: v.lastCall }))
    .sort((a, b) => b.lastCall.localeCompare(a.lastCall) || a.symbol.localeCompare(b.symbol))
    .slice(0, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/rail-stocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rail-stocks.ts src/lib/rail-stocks.test.ts
git commit -m "feat(rail): topStocksByLastCall helper"
```

---

## Task 2: `parseSparkResponse` parser + `sampleCloses`

**Files:**

- Create: `src/lib/spark-parse.ts`
- Test: `src/lib/spark-parse.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface Spark1D {
    changePct: number | null;
    closes: number[];
  }
  export function sampleCloses(closes: number[], max?: number): number[]; // ≤max, keeps first+last
  export function parseSparkResponse(json: unknown, maxPoints?: number): Record<string, Spark1D>;
  ```

  Defensive parse of Yahoo's v7 `/finance/spark` JSON. Per symbol: `closes` = non-null `indicators.quote[0].close`, downsampled to `maxPoints` (default 24); `changePct` = `(last − prevClose) / prevClose` using `meta.chartPreviousClose ?? meta.previousClose`, falling back to first close. Symbols with <2 valid closes are omitted. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/lib/spark-parse.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseSparkResponse, sampleCloses } from "./spark-parse";

test("sampleCloses keeps first+last and caps length", () => {
  const arr = Array.from({ length: 100 }, (_, i) => i);
  const out = sampleCloses(arr, 10);
  expect(out.length).toBe(10);
  expect(out[0]).toBe(0);
  expect(out.at(-1)).toBe(99);
});

test("parseSparkResponse: good symbol uses prevClose for changePct", () => {
  const json = {
    spark: {
      result: [
        {
          symbol: "AAPL",
          response: [
            {
              meta: { chartPreviousClose: 100 },
              indicators: { quote: [{ close: [101, 102, null, 110] }] },
            },
          ],
        },
      ],
    },
  };
  const out = parseSparkResponse(json);
  expect(out.AAPL.closes).toEqual([101, 102, 110]); // null dropped
  expect(out.AAPL.changePct).toBeCloseTo(0.1, 5); // (110-100)/100
});

test("parseSparkResponse: symbol with <2 valid closes is omitted", () => {
  const json = {
    spark: {
      result: [
        { symbol: "THIN", response: [{ meta: {}, indicators: { quote: [{ close: [null, 5] }] } }] },
      ],
    },
  };
  expect(parseSparkResponse(json).THIN).toBeUndefined();
});

test("parseSparkResponse: malformed input → empty object, no throw", () => {
  expect(parseSparkResponse(null)).toEqual({});
  expect(parseSparkResponse({ spark: {} })).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/spark-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/spark-parse.ts`:

```ts
export interface Spark1D {
  changePct: number | null;
  closes: number[];
}

// Evenly sample a series down to `max` points, always keeping first + last.
export function sampleCloses(closes: number[], max = 24): number[] {
  if (closes.length <= max) return closes;
  if (max <= 1) return closes.slice(0, 1);
  const step = (closes.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => closes[Math.round(i * step)]);
}

// Defensive parse of Yahoo's v7 /finance/spark response. Tolerant of shape drift:
// anything unexpected for a symbol drops that symbol rather than throwing.
export function parseSparkResponse(json: unknown, maxPoints = 24): Record<string, Spark1D> {
  const out: Record<string, Spark1D> = {};
  const results = (json as any)?.spark?.result;
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const symbol = typeof r?.symbol === "string" ? r.symbol.toUpperCase() : null;
    const resp = r?.response?.[0];
    const raw = resp?.indicators?.quote?.[0]?.close;
    if (!symbol || !Array.isArray(raw)) continue;
    const closes = raw.filter(
      (v: unknown): v is number => typeof v === "number" && Number.isFinite(v),
    );
    if (closes.length < 2) continue;
    const prev = resp?.meta?.chartPreviousClose ?? resp?.meta?.previousClose ?? closes[0];
    const last = closes[closes.length - 1];
    const changePct = typeof prev === "number" && prev !== 0 ? (last - prev) / prev : null;
    out[symbol] = { changePct, closes: sampleCloses(closes, maxPoints) };
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/spark-parse.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark-parse.ts src/lib/spark-parse.test.ts
git commit -m "feat(rail): parseSparkResponse + sampleCloses for 1D sparks"
```

---

## Task 3: `smoothPath` SVG helper

**Files:**

- Create: `src/lib/svg-smooth.ts`
- Test: `src/lib/svg-smooth.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface Pt {
    x: number;
    y: number;
  }
  export function smoothPath(points: Pt[]): string; // "" for <2 pts; "M..L.." for 2; Catmull-Rom cubic for ≥3
  ```

  Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/lib/svg-smooth.test.ts`:

```ts
import { test, expect } from "bun:test";
import { smoothPath } from "./svg-smooth";

test("empty for fewer than 2 points", () => {
  expect(smoothPath([])).toBe("");
  expect(smoothPath([{ x: 0, y: 0 }])).toBe("");
});

test("two points draw a straight line", () => {
  expect(
    smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]),
  ).toBe("M0,0 L10,5");
});

test("three+ points produce cubic segments starting at first point", () => {
  const d = smoothPath([
    { x: 0, y: 0 },
    { x: 5, y: 10 },
    { x: 10, y: 0 },
  ]);
  expect(d.startsWith("M0,0")).toBe(true);
  expect(d.includes("C")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/svg-smooth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/svg-smooth.ts`:

```ts
export interface Pt {
  x: number;
  y: number;
}

const n = (v: number) => Number(v.toFixed(2));

// Catmull-Rom spline → cubic béziers, for a gently rounded sparkline. Tension 1
// (uniform). Endpoints duplicate their neighbour so the curve passes through
// every point. 2 points fall back to a straight line; <2 to empty.
export function smoothPath(points: Pt[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M${n(points[0].x)},${n(points[0].y)} L${n(points[1].x)},${n(points[1].y)}`;
  }
  let d = `M${n(points[0].x)},${n(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${n(c1x)},${n(c1y)} ${n(c2x)},${n(c2y)} ${n(p2.x)},${n(p2.y)}`;
  }
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/svg-smooth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/svg-smooth.ts src/lib/svg-smooth.test.ts
git commit -m "feat(sparkline): smoothPath Catmull-Rom helper"
```

---

## Task 4: Upgrade `Sparkline` — gradient fill + smoothed joints

**Files:**

- Modify: `src/components/Sparkline.tsx` (full replace)

**Interfaces:**

- Consumes: `smoothPath`, `Pt` (Task 3); `useId` from React.
- Produces: same `Sparkline` props as today (`closes`, `excess`, `width?`, `height?`) — drop-in; now renders a smoothed line + gradient area fill. Also used by `RailStocks` (Task 6) and the call table (unchanged call site).

**No unit test** (presentational; path math covered by Task 3). Verified by typecheck + visual.

- [ ] **Step 1: Replace the component**

Replace the **entire** contents of `src/components/Sparkline.tsx`:

```tsx
import { useId } from "react";
import { smoothPath, type Pt } from "#/lib/svg-smooth.ts";

// Mini stock-path sparkline from a close series: smoothed line + gradient area
// fill fading to transparent at the baseline, dot at the first point. Colored by
// the sign of `excess` (to-date excess in the call table, 1D change in the rail).
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
  const gid = useId().replace(/:/g, ""); // strip colons — invalid in some SVG url(#…) contexts
  if (closes.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...closes),
    max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);

  const pts: Pt[] = closes.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const baseline = height; // fill drops to the bottom edge
  const area = `${line} L${pts.at(-1)!.x.toFixed(2)},${baseline} L${pts[0].x.toFixed(2)},${baseline} Z`;

  const color =
    excess == null ? "var(--muted-foreground)" : excess >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      <circle cx={x(0)} cy={y(closes[0])} r={2} fill={color} />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors at `Sparkline.tsx` or its call site `c.$handle.index.tsx:461`).

- [ ] **Step 3: Commit**

```bash
git add src/components/Sparkline.tsx
git commit -m "feat(sparkline): gradient area fill + smoothed joints"
```

---

## Task 5: `fetch1DSparks` server fn + `sparks1dQuery`

**Files:**

- Create: `src/lib/spark-fetch.ts`
- Create: `src/lib/spark-query.ts`

**Interfaces:**

- Consumes: `parseSparkResponse`, `Spark1D` (Task 2); `isSafeAssetKey` (`./api-serve.ts`).
- Produces:
  ```ts
  export const fetch1DSparks: (opts: {
    data: { symbols: string[] };
  }) => Promise<Record<string, Spark1D>>;
  export function sparks1dQuery(symbols: string[]): UseQueryOptions<Record<string, Spark1D>>;
  ```
  Consumed by Task 6.

**No unit test** (network/server fn; parse covered by Task 2). Verified by typecheck + visual.

- [ ] **Step 1: Create the server fn**

Create `src/lib/spark-fetch.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve.ts";
import { parseSparkResponse, type Spark1D } from "./spark-parse.ts";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: Record<string, Spark1D> }>();

const InputSchema = z.object({
  symbols: z.array(z.string().min(1).max(40)).max(30),
});

// Batched 1D intraday sparks for the rail. One upstream request to Yahoo's
// multi-symbol spark endpoint; 5-min cache keyed by the sorted symbol set.
// Fail-open: any error returns {} so the rail still renders its static list.
export const fetch1DSparks = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<Record<string, Spark1D>> => {
    const symbols = [...new Set(data.symbols.map((s) => s.toUpperCase()))]
      .filter(isSafeAssetKey)
      .sort();
    if (symbols.length === 0) return {};

    const key = symbols.join(",");
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at <= TTL_MS) return hit.data;

    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(key)}&range=1d&interval=5m&indicators=close`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`spark: ${res.status}`);
      const json = await res.json();
      const parsed = parseSparkResponse(json);
      cache.set(key, { at: now, data: parsed });
      return parsed;
    } catch (err) {
      console.warn("[fetch1DSparks] failed, returning empty:", (err as Error)?.message ?? err);
      return {};
    }
  });
```

- [ ] **Step 1b: Verify the real Yahoo spark JSON shape before trusting the parser**

The parser in Task 2 assumes a JSON shape that is **not** verified against the live
endpoint — a wrong shape fails _silently open_ (no sparklines ever, no error). Capture
one real response and confirm `parseSparkResponse` extracts closes from it:

Run: `curl -s 'https://query1.finance.yahoo.com/v7/finance/spark?symbols=AAPL,MSFT&range=1d&interval=5m&indicators=close' -H 'User-Agent: Mozilla/5.0' | head -c 1500`
Expected: JSON where each symbol's closes live at `spark.result[i].response[0].indicators.quote[0].close` and a previous close at `spark.result[i].response[0].meta.chartPreviousClose` (or `.previousClose`). If the real shape differs (Yahoo has historically shipped variants), **update `parseSparkResponse` + its fixture in Task 2 to match the captured shape** and re-run `bun test src/lib/spark-parse.test.ts`. Do not proceed until a captured fixture parses to non-empty closes.

- [ ] **Step 2: Create the query options**

Create `src/lib/spark-query.ts`:

```ts
import { queryOptions } from "@tanstack/react-query";
import { fetch1DSparks } from "./spark-fetch.ts";
import type { Spark1D } from "./spark-parse.ts";

// One batched query for all rail sparklines. Disabled until symbols are known so
// SSR/first paint never waits on it. Keyed by the sorted set so the cache is
// shared regardless of input order.
export function sparks1dQuery(symbols: string[]) {
  const sorted = [...symbols].sort();
  return queryOptions<Record<string, Spark1D>>({
    queryKey: ["sparks1d", sorted],
    queryFn: () => fetch1DSparks({ data: { symbols: sorted } }),
    staleTime: 2 * 60 * 1000,
    enabled: sorted.length > 0,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/spark-fetch.ts src/lib/spark-query.ts
git commit -m "feat(rail): batched fetch1DSparks server fn + query"
```

---

## Task 6: `RailStocks` component

**Files:**

- Create: `src/components/RailStocks.tsx`

**Interfaces:**

- Consumes: `RailStock` (Task 1); `sparks1dQuery` (Task 5); `Sparkline` (Task 4); `ScrollArea` (`./ui/scroll-area`); `Link`, `useQuery`.
- Produces:
  ```ts
  export function RailStocks(props: {
    stocks: RailStock[];
    onNavigate?: () => void;
  }): React.ReactElement;
  ```
  Consumed by Task 7. The lazy 1D query lives here (mounts with the rail).

**No unit test** (presentational). Verified by typecheck + visual.

- [ ] **Step 1: Create the component**

Create `src/components/RailStocks.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "./ui/scroll-area";
import { Sparkline } from "./Sparkline";
import { sparks1dQuery } from "#/lib/spark-query.ts";
import type { RailStock } from "#/lib/rail-stocks.ts";

function pctChip(changePct: number | null) {
  if (changePct == null)
    return <span className="font-mono text-[10px] text-muted-foreground tabular-nums">—</span>;
  const cls =
    changePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <span className={`font-mono text-[10px] tabular-nums ${cls}`}>
      {changePct >= 0 ? "+" : ""}
      {(changePct * 100).toFixed(1)}%
    </span>
  );
}

// Rail Stocks list: static rows from the loader; 1D sparklines lazy-fetched in one
// batched query (does not block SSR). Own lina ScrollArea so it scrolls
// independently of the Creators list.
export function RailStocks({
  stocks,
  onNavigate,
}: {
  stocks: RailStock[];
  onNavigate?: () => void;
}) {
  const symbols = stocks.map((s) => s.symbol);
  const { data } = useQuery(sparks1dQuery(symbols));

  if (stocks.length === 0) {
    return <div className="px-2 py-1.5 text-muted-foreground/60 text-xs">No stocks yet</div>;
  }

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="px-2 pb-2">
      <ul className="flex flex-col gap-0.5">
        {stocks.map((s) => {
          const spark = data?.[s.symbol];
          return (
            <li key={s.symbol}>
              <Link
                to="/t/$symbol/$creator"
                params={{ symbol: s.symbol, creator: "all" }}
                onClick={onNavigate}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 no-underline transition-colors hover:bg-foreground/[0.03]"
                activeProps={{
                  className:
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 bg-foreground/[0.06] no-underline",
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm text-foreground">{s.symbol}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{s.company}</div>
                </div>
                {spark ? (
                  <Sparkline
                    closes={spark.closes}
                    excess={spark.changePct}
                    width={48}
                    height={18}
                  />
                ) : (
                  <span className="block h-[18px] w-12 animate-pulse rounded bg-foreground/[0.06]" />
                )}
                <span className="w-10 text-right">{pctChip(spark?.changePct ?? null)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS. (Requires the `/t/$symbol/$creator` route from the prerequisite plan; if it errors on the `Link` target, that plan is not yet applied.)

- [ ] **Step 3: Commit**

```bash
git add src/components/RailStocks.tsx
git commit -m "feat(rail): RailStocks section with lazy 1D sparklines"
```

---

## Task 7: Wire into the rail + root loader

**Files:**

- Modify: `src/routes/__root.tsx` (loader + render)
- Modify: `src/components/WorkspaceRail.tsx` (`WorkspaceRail` + `RailContent`)
- Modify: `src/components/MobileNav.tsx` (forward `stocks`)

**Interfaces:**

- Consumes: `topStocksByLastCall` (Task 1), `RailStocks` (Task 6), `RailStock` (Task 1), `fetchCallsIndex` (`../lib/data`).

- [ ] **Step 1: Root loader returns creators + stocks**

In `src/routes/__root.tsx`:

Add imports near the existing data import:

```tsx
import { listCreators, fetchCallsIndex } from "../lib/data";
import { topStocksByLastCall } from "../lib/rail-stocks";
```

Replace the loader (line ~24):

```tsx
  loader: async () => {
    const [creators, index] = await Promise.all([listCreators(), fetchCallsIndex()])
    return { creators, stocks: topStocksByLastCall(index) }
  },
```

Update the loader-data destructure (line ~62) from `const creators = Route.useLoaderData()` to:

```tsx
const { creators, stocks } = Route.useLoaderData();
```

Update the two render sites (lines ~89, ~92):

```tsx
<WorkspaceRail creators={creators} stocks={stocks} />
```

```tsx
<MobileNav creators={creators} stocks={stocks} />
```

- [ ] **Step 2: Thread `stocks` through `WorkspaceRail` + render the section**

In `src/components/WorkspaceRail.tsx`:

Add the import and a re-exported type:

```tsx
import { RailStocks } from "./RailStocks";
import type { RailStock } from "#/lib/rail-stocks.ts";
```

Change `WorkspaceRail` to accept + forward `stocks`:

```tsx
export function WorkspaceRail({
  creators,
  stocks,
}: {
  creators: CreatorRef[];
  stocks: RailStock[];
}) {
  return (
    <aside className="h-svh border-r border-border/60">
      <RailContent creators={creators} stocks={stocks} />
    </aside>
  );
}
```

Change `RailContent`'s signature to accept `stocks`:

```tsx
export function RailContent({
  creators,
  stocks,
  onNavigate,
}: {
  creators: CreatorRef[];
  stocks: RailStock[];
  onNavigate?: () => void;
}) {
```

The current body wraps nav + Creators in **one** `ScrollArea` (`mt-3 min-h-0 flex-1`). Restructure so Creators and Stocks are two independent scroll regions. Replace the single `<ScrollArea className="mt-3 min-h-0 flex-1" ...>...</ScrollArea>` block with:

```tsx
      <ScrollArea className="mt-3 min-h-0 flex-1" viewportClassName="px-2 pb-4">
        <nav>
          <ul className="flex flex-col gap-0.5">
            {/* Home + Explore links — unchanged, keep the existing two <li> blocks here */}
          </ul>
          <SectionLabel>Creators</SectionLabel>
          <ul className="flex flex-col gap-0.5">
            {/* Creators list — unchanged, keep the existing creators.map(...) block here */}
          </ul>
        </nav>
      </ScrollArea>

      <SectionLabel>Stocks</SectionLabel>
      <RailStocks stocks={stocks} onNavigate={onNavigate} />
```

Keep the existing Home/Explore `<li>` blocks and the `creators.map(...)` block verbatim inside the first ScrollArea (only the surrounding structure changes; do not retype their internals). `RailStocks` brings its own lina `ScrollArea` and `flex-1`, so it shares the column's remaining height with the first region — the two scroll independently. The outer container is already `flex h-full flex-col`, so both `flex-1` regions split the space.

- [ ] **Step 3: Forward `stocks` through `MobileNav`**

In `src/components/MobileNav.tsx`:

Update the import to also pull `RailStock`, and the signature + `RailContent` call:

```tsx
import { type CreatorRef, type RailStock, RailContent } from "./WorkspaceRail";
```

```tsx
export function MobileNav({ creators, stocks }: { creators: CreatorRef[]; stocks: RailStock[] }) {
```

```tsx
<RailContent creators={creators} stocks={stocks} onNavigate={() => setOpen(false)} />
```

Also re-export `RailStock` from `WorkspaceRail.tsx` so the `MobileNav` import resolves — add to `WorkspaceRail.tsx`:

```tsx
export type { RailStock } from "#/lib/rail-stocks.ts";
```

- [ ] **Step 4: Typecheck + tests + build**

Run: `bunx tsc --noEmit && bun test && bun run build`
Expected: all PASS. (Build regenerates `routeTree.gen.ts`.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/__root.tsx src/components/WorkspaceRail.tsx src/components/MobileNav.tsx
git commit -m "feat(rail): wire Stocks section into rail + root loader"
```

---

## Final verification (on `main` after merge)

- Rail shows a **Stocks** section under Creators, both in their own independently-scrolling regions.
- Each stock row: symbol + company + a smoothed, gradient-filled 1D sparkline + colored % chip; clicking opens `/t/<symbol>/all`.
- Sparklines appear shortly after load (lazy query), with a skeleton placeholder first; first paint is not blocked. **If they never appear**, the Yahoo spark JSON shape differs from the parser's assumption (Task 5 Step 1b) — capture a real response and fix `parseSparkResponse`. (Fail-open means "no sparkline" is the silent failure mode, not a crash.)
- Call-table sparklines (`/c/<handle>`) now also show the gradient fill + smoothed line.
- Yahoo-down case: rows render with "—" deltas and no sparkline; nothing crashes.
- Mobile drawer shows the same Stocks section.

---

## Self-Review (completed)

- **Spec coverage:** top-20 list in root loader (T1, T7); batched cached server fn → v7 spark endpoint (T5); fail-open parse (T2, T5); client lazy query (T5, T6); own lina ScrollArea / two regions (T6, T7); reuse Sparkline (T6); gradient fill + smoothed joints (T3, T4); MobileNav parity (T7). Error/empty states (T5, T6). Out-of-scope items omitted.
- **Placeholder scan:** none — every code step is complete. T7 Step 2 explicitly says to keep the existing Home/Explore + creators blocks verbatim (their internals are already in the file being modified, not reproduced to avoid divergence).
- **Type consistency:** `RailStock` (T1) used in T6/T7; `Spark1D` (T2) returned by T5, consumed in T6; `Pt`/`smoothPath` (T3) used in T4; `sparks1dQuery` (T5) used in T6. Loader return `{ creators, stocks }` matches the T7 destructure and both render sites.
