# Influencer-Tracker Accuracy UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard answer "which finfluencer is most accurate" honestly — a sortable leaderboard with visible sample sizes, reconciled win-rate figures, working call markers, timeframe tabs, and per-call sparklines.

**Architecture:** Expose sample counts through the existing score pipeline (no methodology change), then rework the UI surfaces. Charts reuse the vendored bklit components under `src/components/charts/`; we vendor the missing `markers/` subpackage from `bklit/bklit-ui`. Pure logic (scorecard counts, funnel, time-window filtering) is extracted into testable functions.

**Tech Stack:** Bun, TypeScript, TanStack Start (file routes), Zod (dataset schema), bklit charts (@visx + d3 + motion), Tailwind v4. Tests: `bun test`. Typecheck: `bunx tsc --noEmit`. Import alias `#/` → `src/`. Run all commands from `influencer-tracker/`.

**Branch:** `accuracy-ui-redesign` (already created off `main`).

**Spec:** `docs/superpowers/specs/2026-06-03-influencer-tracker-accuracy-ui-design.md`

---

## File Structure

**Created:**

- `src/lib/window-series.ts` — pure calendar-window filter for OHLC arrays (+ `Timeframe` type)
- `src/lib/window-series.test.ts`
- `src/components/TimeframeTabs.tsx` — sliding-pill tab control
- `src/components/Sparkline.tsx` — native-SVG per-row mini chart
- `src/components/charts/markers/chart-markers.tsx` — vendored from bklit
- `src/components/charts/markers/marker-group.tsx` — vendored from bklit
- `src/components/charts/markers/index.ts` — vendored from bklit

**Modified:**

- `src/lib/types.ts` — add `hitRateN` to `Scorecard`
- `src/lib/schema.ts` — add `hitRateN` to the Zod scorecard object
- `src/lib/scorecard.ts` — compute `hitRateN`; extract `buildFunnel`; export `LOW_CONFIDENCE_N`
- `src/lib/scorecard.test.ts` — cases for `hitRateN` and `buildFunnel`
- `pipeline/score.ts` — use `buildFunnel` (5 stages); widen `index.json` entry
- `src/lib/data.ts` — widen `listCreators` return type
- `src/routes/index.tsx` — sortable leaderboard
- `src/routes/c.$handle.index.tsx` — `n` on hit rate, staleness, first-badge tooltip, sparkline column
- `src/components/AnalyticsCharts.tsx` — gauge shows `n`/low-confidence
- `src/routes/c.$handle.ticker.$symbol.tsx` — call markers + timeframe tabs
- `src/styles.css` — `.t-tabs` sliding-pill styles (themed)

---

## WORKSTREAM A — Data layer (sample sizes, honest funnel)

### Task 1: Add `hitRateN` to the scorecard

**Files:**

- Modify: `src/lib/types.ts:22-31`
- Modify: `src/lib/scorecard.ts:18-44`
- Modify: `src/lib/schema.ts:34-40`
- Test: `src/lib/scorecard.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/scorecard.test.ts` (match the existing import style in that file; it already imports `buildScorecard` and builds `Call` fixtures — reuse its helpers if present, otherwise inline a minimal call factory as below):

```ts
import { test, expect } from "bun:test";
import { buildScorecard } from "./scorecard";
import type { Call, Horizon, ReturnTriple } from "./types";

function ret(excess: number | null): ReturnTriple {
  return { stock: excess, spy: 0, excess };
}
function call(ticker: string, postDate: string, ex: Partial<Record<Horizon, number | null>>): Call {
  return {
    shortcode: ticker + postDate,
    postDate,
    ticker,
    company: ticker,
    isFirstCall: false,
    conviction: 0.5,
    quote: "q",
    returns: {
      "1w": ret(ex["1w"] ?? null),
      "1m": ret(ex["1m"] ?? null),
      "3m": ret(ex["3m"] ?? null),
      toDate: ret(ex["toDate"] ?? null),
    },
  };
}

test("hitRateN counts first-calls with elapsed excess per horizon", () => {
  // 3 distinct tickers => all first calls. Two have 3m data, one is pending at 3m.
  const calls: Call[] = [
    { ...call("AAA", "2025-01-01", { "3m": 0.1, "1m": 0.1 }), isFirstCall: true },
    { ...call("BBB", "2025-01-02", { "3m": -0.2, "1m": 0.0 }), isFirstCall: true },
    { ...call("CCC", "2025-01-03", { "3m": null, "1m": 0.3 }), isFirstCall: true },
  ];
  const sc = buildScorecard(calls);
  expect(sc.hitRateN["3m"]).toBe(2); // AAA, BBB have 3m; CCC pending
  expect(sc.hitRateN["1m"]).toBe(3);
  expect(sc.hitRate["3m"]).toBeCloseTo(0.5); // AAA up, BBB down => 1/2
});

test("hitRateN is 0 when all calls pending", () => {
  const calls: Call[] = [{ ...call("AAA", "2025-01-01", {}), isFirstCall: true }];
  const sc = buildScorecard(calls);
  expect(sc.hitRateN["3m"]).toBe(0);
  expect(sc.hitRate["3m"]).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/scorecard.test.ts`
Expected: FAIL — `sc.hitRateN` is undefined (property does not exist).

- [ ] **Step 3: Add the type**

In `src/lib/types.ts`, inside `interface Scorecard` (after the `hitRate` line):

```ts
  hitRate: { "1m": number; "3m": number };
  hitRateN: { "1m": number; "3m": number };
```

- [ ] **Step 4: Compute it in `buildScorecard`**

In `src/lib/scorecard.ts`, just after the `hit` function (around line 27), add a count helper and include it in the return object:

```ts
const hitN = (h: "1m" | "3m") =>
  first.map((c) => c.returns[h].excess).filter((x): x is number => x != null).length;
```

In the returned object, add after `hitRate`:

```ts
    hitRate: { "1m": hit("1m"), "3m": hit("3m") },
    hitRateN: { "1m": hitN("1m"), "3m": hitN("3m") },
```

- [ ] **Step 5: Add to the Zod schema**

In `src/lib/schema.ts`, inside `scorecard: z.object({ ... })` add after the `hitRate` line (line 36):

```ts
    hitRate: z.object({ "1m": z.number(), "3m": z.number() }),
    hitRateN: z.object({ "1m": z.number(), "3m": z.number() }),
```

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test src/lib/scorecard.test.ts && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/scorecard.ts src/lib/schema.ts src/lib/scorecard.test.ts
git commit -m "feat(scorecard): expose hitRateN sample sizes"
```

---

### Task 2: Honest 5-stage funnel

**Files:**

- Modify: `src/lib/scorecard.ts` (add `buildFunnel` + `LOW_CONFIDENCE_N`)
- Modify: `pipeline/score.ts:28-34`
- Test: `src/lib/scorecard.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/scorecard.test.ts`:

```ts
import { buildFunnel, LOW_CONFIDENCE_N } from "./scorecard";

test("buildFunnel produces 5 monotonically-narrowing stages", () => {
  const f = buildFunnel({ reelsScraped: 157, reelsWithTicker: 27 }, 13, 10, 4);
  expect(f.map((s) => s.value)).toEqual([157, 27, 13, 10, 4]);
  expect(f.map((s) => s.label)).toEqual([
    "Reels (12mo)",
    "Named a stock",
    "Bullish buy call",
    "First call (unique ticker)",
    "Beat SPY (to date)",
  ]);
});

test("LOW_CONFIDENCE_N is 10", () => {
  expect(LOW_CONFIDENCE_N).toBe(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/scorecard.test.ts`
Expected: FAIL — `buildFunnel` / `LOW_CONFIDENCE_N` not exported.

- [ ] **Step 3: Implement in `src/lib/scorecard.ts`**

Add at the top (after imports) and export the helper. Import `FunnelStage`:

```ts
import type { Call, Horizon, Scorecard, FunnelStage } from "./types";

export const LOW_CONFIDENCE_N = 10;

export function buildFunnel(
  counts: { reelsScraped: number; reelsWithTicker: number },
  buyCalls: number,
  firstCalls: number,
  beatSpy: number,
): FunnelStage[] {
  return [
    { label: "Reels (12mo)", value: counts.reelsScraped },
    { label: "Named a stock", value: counts.reelsWithTicker },
    { label: "Bullish buy call", value: buyCalls },
    { label: "First call (unique ticker)", value: firstCalls },
    { label: "Beat SPY (to date)", value: beatSpy },
  ];
}
```

- [ ] **Step 4: Use it in `pipeline/score.ts`**

In `pipeline/score.ts`, import `buildFunnel` from `../src/lib/scorecard` (extend the existing import on line 6), then replace the inline `funnel` array (lines 29-34) with:

```ts
const funnel = counts ? buildFunnel(counts, calls.length, firstCalls.length, beatSpy) : undefined;
```

(`firstCalls`, `beatSpy`, `calls`, `counts` are already in scope at that point — see lines 26-28.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test src/lib/scorecard.test.ts && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scorecard.ts pipeline/score.ts src/lib/scorecard.test.ts
git commit -m "feat(funnel): honest 5-stage funnel with consistent denominators"
```

---

### Task 3: Widen `index.json` entry + `listCreators` type

**Files:**

- Modify: `pipeline/score.ts:60-72` (`updateIndex`)
- Modify: `src/lib/data.ts:9-26`

- [ ] **Step 1: Extend the index entry in `updateIndex`**

In `pipeline/score.ts`, replace the `entry` object (lines 65-67) with:

```ts
const entry = {
  handle,
  name,
  totalCalls: ds.scorecard.totalCalls,
  firstCalls: ds.scorecard.uniqueTickers,
  hitRate3m: ds.scorecard.hitRate["3m"],
  hitRate3mN: ds.scorecard.hitRateN["3m"],
  avgExcess3m: ds.scorecard.avgExcess["3m"],
  generatedAt: ds.generatedAt,
  ...(avatar ? { avatar } : {}),
};
```

- [ ] **Step 2: Widen the `listCreators` return type**

In `src/lib/data.ts`, update the cast type (lines 13-21) to:

```ts
      }) as {
        handle: string;
        name: string;
        totalCalls: number;
        firstCalls: number;
        hitRate3m: number;
        hitRate3mN: number;
        avgExcess3m: number;
        generatedAt: string;
        avatar?: string;
      }[];
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. (Existing `index.json` lacks the new fields, but it's read at runtime, not typechecked. Task 4 regenerates it.)

- [ ] **Step 4: Commit**

```bash
git add pipeline/score.ts src/lib/data.ts
git commit -m "feat(index): carry hit-rate + sample fields for leaderboard"
```

---

### Task 4: Regenerate kevvonz dataset

**Files:** none (data regeneration)

- [ ] **Step 1: Re-run the score stage only**

Run: `bun run pipeline --handle kevvonz --name "Kevin Hu" --from score`
Expected: prints `=== score ===`, no schema error (proves `hitRateN` is in both the writer and the Zod schema), rewrites `data/creators/kevvonz/dataset.json` and `data/creators/index.json`.

- [ ] **Step 2: Verify the new fields landed**

Run:

```bash
cat data/creators/index.json | grep -E "hitRate3m|firstCalls"
cat data/creators/kevvonz/dataset.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('hitRateN', d['scorecard']['hitRateN']); print('funnel', [s['value'] for s in d['scorecard']['funnel']])"
```

Expected: `index.json` contains `hitRate3m`, `hitRate3mN`, `firstCalls`; `hitRateN` shows `{"1m": 7, "3m": 7}`; funnel shows `[157, 27, 13, 10, 4]`.

- [ ] **Step 3: Commit**

```bash
git add data/creators/index.json data/creators/kevvonz/dataset.json
git commit -m "chore(data): regenerate kevvonz with sample sizes + 5-stage funnel"
```

---

## WORKSTREAM D — Working call markers (vendor bklit `markers/`)

### Task 5: Vendor the bklit marker components

**Files:**

- Create: `src/components/charts/markers/chart-markers.tsx`
- Create: `src/components/charts/markers/marker-group.tsx`
- Create: `src/components/charts/markers/index.ts`

- [ ] **Step 1: Fetch the three source files from bklit/bklit-ui (main)**

```bash
mkdir -p src/components/charts/markers
base="https://raw.githubusercontent.com/bklit/bklit-ui/main/packages/ui/src/charts/markers"
for f in chart-markers.tsx marker-group.tsx index.ts; do
  curl -s "$base/$f" -o "src/components/charts/markers/$f"
done
wc -l src/components/charts/markers/*
```

Expected: three non-empty files.

- [ ] **Step 2: Adapt imports to the local conventions**

The only divergence from the local vendored set is the utils alias. In `src/components/charts/markers/marker-group.tsx`, replace:

```ts
import { cn } from "@/lib/utils";
```

with:

```ts
import { cn } from "#/lib/utils.ts";
```

Leave `../chart-context` imports as-is — the local `src/components/charts/chart-context.tsx` already exports `chartCssVars`, `useChart`, and `useChartHover` (verified). `motion/react` and `react-dom` are already project deps.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. If an unexpected import (e.g. another `@/` path) surfaces, repoint it to the matching `#/...` or local `./...` path — do not add new dependencies.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/markers
git commit -m "chore(charts): vendor bklit ChartMarkers/MarkerGroup"
```

---

### Task 6: Replace the transparent-marker hack with real call markers

**Files:**

- Modify: `src/routes/c.$handle.ticker.$symbol.tsx`

Context: today the page maps a `call` field into `norm` and renders `<Line dataKey="call" showMarkers stroke="transparent" />` (lines 102, 64) — markers paint transparent (invisible, confirmed in-app). Remove that and use `ChartMarkers`.

- [ ] **Step 1: Build the markers + remove the `call` series**

In `src/routes/c.$handle.ticker.$symbol.tsx`:

Add imports:

```ts
import {
  ChartMarkers,
  MarkerTooltipContent,
  useActiveMarkers,
  type ChartMarker,
} from "#/components/charts/markers/index.ts";
```

Add a `signed` helper near `pct` (if not already present):

```ts
function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
```

Build the marker list (after `calls` is defined, ~line 45):

```ts
const callMarkers: ChartMarker[] = calls.map((c) => ({
  date: new Date(c.postDate),
  title: `${symbol} · ${c.postDate}`,
  description: `${c.returns.toDate.excess != null ? signed(c.returns.toDate.excess) + " vs SPY · " : ""}${c.quote}`,
}));
```

Remove the now-dead `call` property from the `norm` mapping (line 64) — delete the line:

```ts
    call: callDates.has(b.date) ? (b.c / base) * 100 : null,
```

(`callDates` may become unused — remove its declaration on line 46 if so.)

- [ ] **Step 2: Render markers on both charts**

Add a small local tooltip-content component inside the file (above `TickerPage` or as a nested function):

```tsx
function CallMarkerContent({ markers }: { markers: ChartMarker[] }) {
  const active = useActiveMarkers(markers);
  if (active.length === 0) return null;
  return <MarkerTooltipContent markers={active} />;
}
```

In the **candlestick** chart, add `<ChartMarkers items={callMarkers} />` as a child before `<ChartTooltip />`, and give the tooltip the marker content:

```tsx
<CandlestickChart data={candles} style={{ height: 320 }}>
  <Grid horizontal />
  <Candlestick fadedOpacity={0.25} />
  <ChartMarkers items={callMarkers} />
  <XAxis />
  <ChartTooltip>
    <CallMarkerContent markers={callMarkers} />
  </ChartTooltip>
</CandlestickChart>
```

In the **line** chart, replace the `<Line dataKey="call" .../>` line with `<ChartMarkers items={callMarkers} />` and add the content to its tooltip:

```tsx
<LineChart data={norm}>
  <Grid horizontal highlightRowValues={[100]} />
  <Line dataKey="stock" />
  <Line dataKey="spy" stroke="var(--chart-3)" />
  <ChartMarkers items={callMarkers} />
  <XAxis />
  <ChartTooltip>
    <CallMarkerContent markers={callMarkers} />
  </ChartTooltip>
</LineChart>
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify in the running app (the regression we proved)**

With the dev server running (`bun run dev`, or the user's existing instance), open `/c/kevvonz/ticker/VOO`. Confirm: **visible markers** (guide line + dot) at the three call dates (2025-09-06, 2025-10-31, 2026-01-28) on the stock-vs-SPY line chart, and hovering a marker shows a tooltip with the date + excess + quote. Screenshot the line chart for the before/after record.
Expected: markers visible on both charts; tooltip shows call detail.

If `ChartMarkers` fails to position inside `CandlestickChart` (different context shape), fall back to rendering markers on the line chart only and file a follow-up — do not block the workstream.

- [ ] **Step 5: Commit**

```bash
git add src/routes/c.$handle.ticker.$symbol.tsx
git commit -m "fix(ticker): visible call markers with hover tooltips (replace transparent hack)"
```

---

## WORKSTREAM B — Leaderboard

### Task 7: Sortable cross-creator leaderboard

**Files:**

- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Rewrite `Landing` as a sortable table**

Replace the body of `src/routes/index.tsx` with the following (keeps the existing `Route`/`loader`; adds sort state + low-confidence handling + avatar):

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon } from "lucide-react";
import { useState } from "react";
import { listCreators } from "../lib/data";
import { LOW_CONFIDENCE_N } from "../lib/scorecard";

export const Route = createFileRoute("/")({
  loader: () => listCreators(),
  component: Landing,
});

type Creator = Awaited<ReturnType<typeof listCreators>>[number];
type SortKey = "hitRate3m" | "avgExcess3m" | "totalCalls";

function pct(x: number) {
  return `${(x * 100).toFixed(0)}%`;
}
function signed(x: number) {
  return `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
function lowConf(c: Creator) {
  return c.hitRate3mN < LOW_CONFIDENCE_N;
}

function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

// Proven creators first; within each group sort by key desc. Low-confidence always last.
function sortCreators(creators: Creator[], key: SortKey, dir: 1 | -1): Creator[] {
  return [...creators].sort((a, b) => {
    const la = lowConf(a) ? 1 : 0,
      lb = lowConf(b) ? 1 : 0;
    if (la !== lb) return la - lb;
    return (a[key] - b[key]) * dir;
  });
}

function Landing() {
  const creators = Route.useLoaderData();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "hitRate3m", dir: -1 });
  const rows = sortCreators(creators, sort.key, sort.dir);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
          Signal Tracker · vs SPY
        </div>
        <h1 className="mt-1 font-heading text-2xl">Influencer accuracy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ranked by 3-month hit rate — share of first calls per ticker that beat SPY. Sample size
          shown; thin samples are flagged and ranked last.
        </p>
      </header>

      {creators.length === 0 ? (
        <p className="text-sm text-muted-foreground">No creators yet. Run the pipeline.</p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
          <div className="grid grid-cols-[2rem_1fr_7rem_6rem_5rem_5rem] items-center gap-3 border-border/40 border-b px-5 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
            <span>#</span>
            <span>Creator</span>
            <button
              type="button"
              className="text-right hover:text-foreground"
              onClick={() => onSort("hitRate3m")}
            >
              Hit 3m
            </button>
            <button
              type="button"
              className="text-right hover:text-foreground"
              onClick={() => onSort("avgExcess3m")}
            >
              Excess 3m
            </button>
            <button
              type="button"
              className="text-right hover:text-foreground"
              onClick={() => onSort("totalCalls")}
            >
              Calls
            </button>
            <span className="text-right">Updated</span>
          </div>
          <ul className="divide-border/40 divide-y">
            {rows.map((c, i) => (
              <li key={c.handle}>
                <Link
                  to="/c/$handle"
                  params={{ handle: c.handle }}
                  className="grid grid-cols-[2rem_1fr_7rem_6rem_5rem_5rem] items-center gap-3 px-5 py-4 no-underline transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 items-center gap-3">
                    {c.avatar ? (
                      <img
                        src={c.avatar}
                        alt=""
                        className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border/60"
                      />
                    ) : (
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-xs uppercase text-foreground ring-1 ring-border/60">
                        {c.handle.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm text-foreground">{c.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">@{c.handle}</div>
                    </div>
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    <div className="text-foreground">{pct(c.hitRate3m)}</div>
                    <div
                      className={`text-[10px] ${lowConf(c) ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                    >
                      {lowConf(c)
                        ? `low · ${Math.round(c.hitRate3m * c.hitRate3mN)}/${c.hitRate3mN}`
                        : `${Math.round(c.hitRate3m * c.hitRate3mN)}/${c.hitRate3mN}`}
                    </div>
                  </div>
                  <div
                    className={`flex items-center justify-end gap-1 font-mono text-sm tabular-nums ${c.avgExcess3m > 0 ? "text-emerald-600 dark:text-emerald-400" : c.avgExcess3m < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}
                  >
                    {c.avgExcess3m > 0 ? (
                      <ArrowUpRightIcon className="size-3.5" />
                    ) : c.avgExcess3m < 0 ? (
                      <ArrowDownRightIcon className="size-3.5" />
                    ) : null}
                    {signed(c.avgExcess3m)}
                  </div>
                  <div className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {c.totalCalls}
                  </div>
                  <div className="text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                    {relativeDate(c.generatedAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
```

NOTE: `Math.round(c.hitRate3m * c.hitRate3mN)` reconstructs the numerator (beats) from rate×n for the `beats/n` label.

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in app**

Open `/`. Expected: kevvonz row shows `57%` with `low · 4/7` flag (n=7 < 10), avatar rendered, columns sortable on header click, single-row table renders cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat(leaderboard): sortable creator ranking with sample sizes + low-confidence flag"
```

---

## WORKSTREAM C — Creator-page trust fixes

### Task 8: Show `n` on the hit-rate gauge + tile

**Files:**

- Modify: `src/components/AnalyticsCharts.tsx:23-34` (`HitRateGauge`)
- Modify: `src/routes/c.$handle.index.tsx:40-46` (tiles) + `:70-80` (gauge pane)

- [ ] **Step 1: Caption the gauge with `n` + low-confidence**

In `src/components/AnalyticsCharts.tsx`, import the constant and wrap the gauge with a caption:

```ts
import { LOW_CONFIDENCE_N } from "#/lib/scorecard.ts";
```

Change `HitRateGauge` to render the caption under the gauge:

```tsx
export function HitRateGauge({ ds }: { ds: Dataset }) {
  const sc = ds.scorecard;
  const n = sc.hitRateN["3m"];
  const beats = Math.round(sc.hitRate["3m"] * n);
  return (
    <div>
      <Gauge
        value={Math.round(sc.hitRate["3m"] * 100)}
        centerValue={sc.hitRate["3m"]}
        defaultLabel="beat SPY"
        inactiveFillOpacity={0.4}
        formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
      />
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {beats} of {n} first calls · 3m
        {n < LOW_CONFIDENCE_N && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">· low confidence</span>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add `n` to the hit-rate tile**

In `src/routes/c.$handle.index.tsx`, change the "Hit rate 3m" tile (line 44) to append the fraction:

```ts
    { label: "Hit rate 3m", value: `${pct(sc.hitRate["3m"])} · ${Math.round(sc.hitRate["3m"] * sc.hitRateN["3m"])}/${sc.hitRateN["3m"]}`, tone: sc.hitRate["3m"] - 0.5 },
```

- [ ] **Step 3: Typecheck + verify**

Run: `bunx tsc --noEmit`
Open `/c/kevvonz`. Expected: gauge shows "4 of 7 first calls · 3m · low confidence"; tile shows "57% · 4/7".

- [ ] **Step 4: Commit**

```bash
git add src/components/AnalyticsCharts.tsx src/routes/c.$handle.index.tsx
git commit -m "feat(scorecard-ui): show sample size + low-confidence on hit rate"
```

---

### Task 9: Staleness banner, risk caption, first-badge tooltip

**Files:**

- Modify: `src/routes/c.$handle.index.tsx`

- [ ] **Step 1: Staleness next to the "as of" date**

In `src/routes/c.$handle.index.tsx`, add a helper near the top:

```ts
function ageDays(iso: string) {
  return Math.round((Date.now() - new Date(iso + "T00:00:00Z").getTime()) / 86400000);
}
```

In the header (the `as of {ds.generatedAt}` div, lines 59-61), append a staleness note:

```tsx
<div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
  as of {ds.generatedAt}
  {ageDays(ds.generatedAt) > 30 && (
    <span className="ml-2 text-amber-600 dark:text-amber-400">
      · data {ageDays(ds.generatedAt)}d old
    </span>
  )}
</div>
```

- [ ] **Step 2: "not risk-adjusted" caption on the horizon-bars pane**

In the "Avg excess vs SPY · by horizon" pane header (line 97-99), append:

```tsx
<div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
  Avg excess vs SPY · by horizon
  <span className="ml-1 normal-case tracking-normal opacity-70">(not risk-adjusted)</span>
</div>
```

- [ ] **Step 3: Tooltip on the `first` badge**

In `CallRow` (line 187-191), add a `title` to the badge span explaining the dedup:

```tsx
<span
  title="Only the earliest call per ticker is scored; later calls on the same ticker are not counted."
  className="rounded-full bg-foreground/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-foreground"
>
  first
</span>
```

- [ ] **Step 4: Typecheck + verify**

Run: `bunx tsc --noEmit`
Open `/c/kevvonz`. Expected: caption renders; first badge has a hover title. (kevvonz `generatedAt` = today, so the staleness note won't show — that's correct.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/c.$handle.index.tsx
git commit -m "feat(creator): staleness note, risk-adjustment caption, first-badge tooltip"
```

---

## WORKSTREAM E — Timeframe tabs on ticker price charts

### Task 10: `TimeframeTabs` component + themed styles

**Files:**

- Create: `src/components/TimeframeTabs.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add the sliding-pill CSS (themed to design tokens)**

Append to `src/styles.css`:

```css
.t-tabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 48px;
  background: var(--muted);
}
.t-tab {
  position: relative;
  appearance: none;
  border: 0;
  background: transparent;
  height: 30px;
  padding: 4px 12px;
  color: var(--muted-foreground);
  cursor: pointer;
  border-radius: 48px;
  z-index: 1;
  font-size: 12px;
  transition: color 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.t-tab:not([aria-selected="true"]):hover,
.t-tab[aria-selected="true"] {
  color: var(--foreground);
}
.t-tabs-pill {
  position: absolute;
  top: 3px;
  left: 0;
  height: 30px;
  width: 0;
  background: var(--background);
  border-radius: 48px;
  transform: translateX(0);
  transition:
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
    width 200ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform, width;
  z-index: 0;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .t-tabs-pill,
  .t-tab {
    transition: none !important;
  }
}
```

- [ ] **Step 2: Build the component**

Create `src/components/TimeframeTabs.tsx`:

```tsx
import { useLayoutEffect, useRef } from "react";
import type { Timeframe } from "#/lib/window-series.ts";

const TABS: Timeframe[] = ["1M", "3M", "6M", "1Y", "All"];

export function TimeframeTabs({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);

  // Position the pill under the active tab. On mount/resize, snap without transition.
  const positionPill = (animate: boolean) => {
    const list = listRef.current,
      pill = pillRef.current;
    if (!list || !pill) return;
    const active = list.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (!active) return;
    if (!animate) {
      pill.style.transition = "none";
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
      void pill.offsetWidth; // force reflow
      pill.style.transition = "";
    } else {
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      pill.style.width = `${active.offsetWidth}px`;
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: position depends on value
  useLayoutEffect(() => {
    positionPill(false);
    const onResize = () => positionPill(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-position on value change
  useLayoutEffect(() => {
    positionPill(true);
  }, [value]);

  return (
    <div className="t-tabs" role="tablist" ref={listRef}>
      <span className="t-tabs-pill" aria-hidden="true" ref={pillRef} />
      {TABS.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          aria-selected={value === tf}
          className="t-tab font-mono"
          onClick={() => onChange(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: error that `#/lib/window-series.ts` has no `Timeframe` export — resolved by Task 11. (If executing strictly in order, do Task 11 before this typecheck, or accept the transient error.)

- [ ] **Step 4: Commit**

```bash
git add src/components/TimeframeTabs.tsx src/styles.css
git commit -m "feat(tabs): sliding-pill timeframe tab control"
```

---

### Task 11: `windowSeries` pure helper (TDD)

**Files:**

- Create: `src/lib/window-series.ts`
- Test: `src/lib/window-series.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/window-series.test.ts`:

```ts
import { test, expect } from "bun:test";
import { windowSeries } from "./window-series";

const bars = Array.from({ length: 400 }, (_, i) => {
  const d = new Date("2025-01-01T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + i);
  return { date: d.toISOString().slice(0, 10), c: i };
});

test("All returns every bar", () => {
  expect(windowSeries(bars, "All").length).toBe(400);
});

test("1M keeps ~last 30 days relative to last bar", () => {
  const w = windowSeries(bars, "1M");
  const last = bars[bars.length - 1].date;
  expect(w[w.length - 1].date).toBe(last);
  // last bar date minus 30 days is the inclusive cutoff
  expect(w.every((b) => b.date >= "2025-12-07")).toBe(true);
  expect(w.length).toBeLessThanOrEqual(31);
  expect(w.length).toBeGreaterThan(0);
});

test("empty input returns empty", () => {
  expect(windowSeries([], "1Y")).toEqual([]);
});
```

(`2025-12-07` = 2026-02-04 last bar minus 30 days; the harness recomputes — assertion uses `>=` so exact boundary is fine. If the computed last bar differs, adjust the literal to `lastDate − 30d`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/window-series.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/window-series.ts`:

```ts
export type Timeframe = "1M" | "3M" | "6M" | "1Y" | "All";

const TF_DAYS: Record<Exclude<Timeframe, "All">, number> = {
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
};

// Keep bars within `tf` calendar days of the LAST bar's date. "All" returns input.
export function windowSeries<T extends { date: string }>(bars: T[], tf: Timeframe): T[] {
  if (tf === "All" || bars.length === 0) return bars;
  const last = bars[bars.length - 1].date;
  const cutoff = new Date(last + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - TF_DAYS[tf]);
  const c = cutoff.toISOString().slice(0, 10);
  return bars.filter((b) => b.date >= c);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/lib/window-series.test.ts && bunx tsc --noEmit`
Expected: PASS (and Task 10's `Timeframe` import now resolves).

- [ ] **Step 5: Commit**

```bash
git add src/lib/window-series.ts src/lib/window-series.test.ts
git commit -m "feat(charts): windowSeries timeframe filter"
```

---

### Task 12: Wire timeframe into the ticker page

**Files:**

- Modify: `src/routes/c.$handle.ticker.$symbol.tsx`

- [ ] **Step 1: Window + rebase on selected timeframe**

In `src/routes/c.$handle.ticker.$symbol.tsx`:

Add imports:

```ts
import { TimeframeTabs } from "#/components/TimeframeTabs.tsx";
import { windowSeries, type Timeframe } from "#/lib/window-series.ts";
```

Inside `TickerPage`, add state and window the RAW ohlc arrays before mapping (replace the `candles`/`base`/`norm` derivations, lines 49-65):

```ts
const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
const ohlcW = windowSeries(ohlc, timeframe);
const spyW = windowSeries(spy, timeframe);

const candles = ohlcW.map((b) => ({
  date: new Date(b.date),
  open: b.o,
  high: b.h,
  low: b.l,
  close: b.c,
}));

const base = ohlcW[0]?.c ?? 1; // rebase to first IN-WINDOW bar
const spyBase = spyW[0]?.c ?? 1;
const spyByDate = new Map(spyW.map((b) => [b.date, b.c]));
const norm = ohlcW.map((b) => ({
  date: new Date(b.date),
  stock: (b.c / base) * 100,
  spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
}));
```

`callMarkers` (from Task 6) is built from all `calls` regardless of window — markers outside the window simply won't map onto the visible scale; that's acceptable. (Optional refinement: filter `callMarkers` to the window with `windowSeries`-style date bounds; not required.)

- [ ] **Step 2: Render the tabs + animate on change**

Add the tabs control to the Price section header (line 80-82), and pass `revealSignature={timeframe}` to both charts so the clip-reveal replays on switch:

```tsx
<div className="mb-4 flex items-center justify-between">
  <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">
    Price
  </div>
  <TimeframeTabs value={timeframe} onChange={setTimeframe} />
</div>
```

On `<CandlestickChart ...>` add `revealSignature={timeframe}`.
On `<LineChart data={norm}>` add `revealSignature={timeframe}`.

- [ ] **Step 3: Typecheck + verify**

Run: `bunx tsc --noEmit`
Open `/c/kevvonz/ticker/VOO`. Expected: tabs render (1Y active); switching to 1M/3M/6M/All re-windows both charts, the line rebases to 100 at the window start, the y-axis rescales, and the data animates in on each switch. Markers still visible.

- [ ] **Step 4: Commit**

```bash
git add src/routes/c.$handle.ticker.$symbol.tsx
git commit -m "feat(ticker): animated timeframe tabs (1M/3M/6M/1Y/All)"
```

---

## WORKSTREAM F — Per-call sparklines

### Task 13: `Sparkline` component

**Files:**

- Create: `src/components/Sparkline.tsx`

- [ ] **Step 1: Build the native-SVG sparkline**

Create `src/components/Sparkline.tsx`:

```tsx
import type { OhlcBar } from "#/lib/types.ts";

// Mini stock-path sparkline from a call date forward, dot at the call (first) point.
// Colored by the call's to-date excess sign.
export function Sparkline({
  bars,
  excess,
  width = 64,
  height = 20,
}: {
  bars: OhlcBar[];
  excess: number | null;
  width?: number;
  height?: number;
}) {
  if (bars.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const closes = bars.map((b) => b.c);
  const min = Math.min(...closes),
    max = Math.max(...closes);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => pad + (i / (closes.length - 1)) * (width - 2 * pad);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - 2 * pad);
  const d = closes
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const color =
    excess == null ? "var(--muted-foreground)" : excess >= 0 ? "rgb(16 185 129)" : "rgb(244 63 94)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <circle cx={x(0)} cy={y(closes[0])} r={2} fill={color} />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sparkline.tsx
git commit -m "feat(charts): per-call Sparkline component"
```

---

### Task 14: Sparkline column in the overview calls list

**Files:**

- Modify: `src/routes/c.$handle.index.tsx` (`CallsList` + `CallRow`)

- [ ] **Step 1: Pass ticker OHLC into each row and render the sparkline**

In `src/routes/c.$handle.index.tsx`:

Add import:

```ts
import { Sparkline } from "#/components/Sparkline.tsx";
```

`CallsList` already receives `ds`. Pass the windowed bars into `CallRow`. Change the `CallRow` render in `CallsList` (line 154-155) to pass bars from the call's post date forward:

```tsx
{
  calls.map((c) => (
    <CallRow
      key={c.shortcode}
      handle={handle}
      call={c}
      bars={(ds.tickers[c.ticker]?.ohlc ?? []).filter((b) => b.date >= c.postDate)}
    />
  ));
}
```

Update `CallRow`'s signature and add a sparkline cell before the excess figure (between the company block and the date, line ~194):

```tsx
function CallRow({ handle, call, bars }: { handle: string; call: Call; bars: import("#/lib/types.ts").OhlcBar[] }) {
```

Insert before the `postDate` div (line 195):

```tsx
<div className="hidden shrink-0 sm:block">
  <Sparkline bars={bars} excess={call.returns.toDate.excess} />
</div>
```

- [ ] **Step 2: Typecheck + verify**

Run: `bunx tsc --noEmit`
Open `/c/kevvonz`. Expected: each call row shows a small green/red sparkline tracing the stock from the call date, dot at the start; hidden on the narrowest screens (`sm:` gate).

- [ ] **Step 3: Commit**

```bash
git add src/routes/c.$handle.index.tsx
git commit -m "feat(creator): per-call sparklines in calls list"
```

---

## Final verification

- [ ] **Full test suite:** `bun test` — all green (scorecard, window-series, returns, schema).
- [ ] **Typecheck:** `bunx tsc --noEmit` — clean.
- [ ] **Manual smoke (dev server):**
  - `/` — leaderboard sorts, kevvonz flagged `low · 4/7`, avatar shows.
  - `/c/kevvonz` — gauge "4 of 7 · low confidence", tile "57% · 4/7", 5-stage funnel, sparklines in rows, risk caption.
  - `/c/kevvonz/ticker/VOO` — **visible** call markers + hover tooltips, timeframe tabs animate the window.
- [ ] **Merge:** per the user's worktree convention, merge `accuracy-ui-redesign` into `main` locally (no PR unless asked); confirm tests pass post-merge.

## Self-review notes (done)

- **Spec coverage:** A→Tasks 1-4; B→Task 7; C→Tasks 8-9; D→Tasks 5-6; E→Tasks 10-12; F→Tasks 13-14. All spec sections mapped.
- **Type consistency:** `hitRateN` shape `{ "1m", "3m" }` consistent across types/schema/scorecard/UI. `Timeframe` defined in Task 11, consumed in Tasks 10 & 12. `LOW_CONFIDENCE_N` defined Task 2, used Tasks 7 & 8.
- **Ordering caveat:** Task 10 typecheck depends on Task 11's `Timeframe` export — noted inline; execute 11 before 10's standalone typecheck, or tolerate the transient error.
- **Known non-placeholder external step:** Task 5 copies real files from bklit/bklit-ui; import-adaptation is fully specified (only `@/lib/utils` → `#/lib/utils.ts`).
