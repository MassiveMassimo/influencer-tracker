# Influencer Signal Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-creator tool that scrapes a finfluencer's Instagram reels, detects explicit bullish stock calls, scores each against real forward prices vs SPY, and visualizes accuracy in a TanStack Start dashboard.

**Architecture:** A monorepo with the existing Python pipeline moved to `stock-pipeline-v2/` and a new Bun/TS app in `influencer-tracker/`. The app has two halves sharing a per-creator `dataset.json`: an offline 6-stage pipeline (scrape → transcribe → frames → extract → prices → score) and a TanStack Start dashboard that reads the dataset.

**Tech Stack:** Bun, TypeScript, Playwright + stealth, ffmpeg, Groq API (whisper-large-v3 + vision + text LLM), yahoo-finance2, TanStack Start, Vite, Tailwind v4, shadcn/ui, bklit-ui charts.

**Reference spec:** `docs/superpowers/specs/2026-06-02-influencer-signal-tracker-design.md`

**Fixture available:** The NBIS reel `DZDmQutB0Ep` (@kevvonz, posted 2026-06-01) is already downloaded under `/tmp/reel/` with a known transcript — use it as the smoke-test fixture.

---

## Phase 0 — Monorepo restructure

### Task 0.1: Move the Python pipeline into `stock-pipeline-v2/`

**Files:**
- Create: `stock-pipeline-v2/` (all existing Python top-level entries move here)
- Keep at root: `.git`, `.gitignore`, `docs/superpowers/`

- [ ] **Step 1: Record the baseline test result (before move)**

Run:
```bash
uv sync --extra dev && uv run pytest -m "not slow" -q | tail -5
```
Expected: a pass/fail summary line (e.g. `N passed`). Note the number — it must match after the move.

- [ ] **Step 2: Create the subfolder and move Python entries**

Run:
```bash
mkdir -p stock-pipeline-v2
for e in AGENTS.md backtest change-requests CLAUDE.md code-skeletons config implementation-plan.md migration ops prompts pyproject.toml README.md schema spec src systemd tests tools uv.lock; do
  git mv "$e" "stock-pipeline-v2/$e"
done
```
Expected: no errors. (`.gitignore` stays at root; `docs/` handled next.)

- [ ] **Step 3: Move Python docs but keep `docs/superpowers/` at root**

Run:
```bash
mkdir -p stock-pipeline-v2/docs
for f in docs/*; do
  [ "$f" = "docs/superpowers" ] || git mv "$f" "stock-pipeline-v2/docs/"
done
ls docs        # should show only: superpowers
```
Expected: `docs/` now contains only `superpowers`.

- [ ] **Step 4: Verify tests still pass from the new location**

Run:
```bash
cd stock-pipeline-v2 && uv sync --extra dev && uv run pytest -m "not slow" -q | tail -5
```
Expected: same pass count as Step 1.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move python pipeline into stock-pipeline-v2/ for monorepo"
```

### Task 0.2: Add the monorepo root CLAUDE.md

**Files:**
- Create: `CLAUDE.md` (root)

- [ ] **Step 1: Write the root monorepo guide**

```markdown
# CLAUDE.md — monorepo root

Two independent subprojects:

- `stock-pipeline-v2/` — Python halal US-equity trading pipeline (uv, pytest).
  Has its own `CLAUDE.md` with full guidance. Run commands from inside that dir.
- `influencer-tracker/` — Bun/TS app that scores finfluencer stock calls against
  real prices. Has its own README. Run commands from inside that dir.

Specs and plans live at root in `docs/superpowers/`.
Do not run one subproject's toolchain from the other's directory.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add monorepo root CLAUDE.md"
```

---

## Phase 1 — Scaffold the influencer-tracker app

### Task 1.1: Create the TanStack Start project

**Files:**
- Create: `influencer-tracker/` (scaffolded)

- [ ] **Step 1: Scaffold with the TanStack CLI (Bun + shadcn add-on)**

Run from repo root:
```bash
bunx @tanstack/cli create influencer-tracker --package-manager bun --add-ons shadcn --no-git -y
```
Expected: `influencer-tracker/` created with `package.json`, `vite.config.ts`, `src/routes/`, Tailwind v4 wired, shadcn initialized (`components.json` present).

- [ ] **Step 2: Verify dev server boots**

Run:
```bash
cd influencer-tracker && bun install && bun run dev &
sleep 5 && curl -s localhost:3000 | head -c 200 ; kill %1
```
Expected: HTML output (not a connection error). Then stop the server.

> NOTE: `curl` may be blocked by the sandbox hook. If so, verify by checking the
> dev server log prints a `localhost` URL with no startup errors instead.

- [ ] **Step 3: Commit**

```bash
git add influencer-tracker
git commit -m "feat: scaffold influencer-tracker TanStack Start app"
```

### Task 1.2: Add dependencies and bklit charts

**Files:**
- Modify: `influencer-tracker/package.json`
- Modify: `influencer-tracker/components.json` (register bklit registry)

- [ ] **Step 1: Add runtime/dev deps**

Run from `influencer-tracker/`:
```bash
bun add yahoo-finance2 zod
bun add -d playwright playwright-extra puppeteer-extra-plugin-stealth @types/bun
bunx playwright install chromium
```
Expected: deps land in `package.json`; Chromium downloads.

- [ ] **Step 2: Register the bklit registry and add charts**

Add to `components.json` under a `registries` key:
```json
"registries": { "@bklit": "https://ui.bklit.com/r/{name}.json" }
```
Then run (all seven charts that map to real data — choropleth/sankey intentionally omitted):
```bash
bunx shadcn@latest add @bklit/candlestick-chart @bklit/composed-chart @bklit/line-chart \
  @bklit/scatter-chart @bklit/bar-chart @bklit/gauge-chart @bklit/funnel-chart
bunx shadcn@latest add card table badge separator
```
Expected: chart components and shadcn primitives created under `src/components/`.

- [ ] **Step 3: Verify chart import resolves**

Create `influencer-tracker/src/_smoke.tsx`:
```tsx
import { LineChart, Line, Grid, XAxis, ChartTooltip } from "@bklitui/ui/charts";
export const _ = { LineChart, Line, Grid, XAxis, ChartTooltip };
```
Run:
```bash
bunx tsc --noEmit
```
Expected: no errors. Then `rm src/_smoke.tsx`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add deps and bklit charts to influencer-tracker"
```

### Task 1.3: Define the shared data contract (types + zod schema)

**Files:**
- Create: `influencer-tracker/src/lib/types.ts`
- Create: `influencer-tracker/src/lib/schema.ts`
- Test: `influencer-tracker/src/lib/schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
import { test, expect } from "bun:test";
import { DatasetSchema } from "./schema";

const valid = {
  creator: { handle: "kevvonz", name: "Kevin Hu" },
  generatedAt: "2026-06-02",
  spyAnchor: "SPY",
  calls: [{
    shortcode: "DZDmQutB0Ep", postDate: "2026-06-01", ticker: "NBIS",
    company: "Nebius Group N.V.", isFirstCall: true, conviction: 0.9,
    quote: "buy right here", onScreenPrice: 273.01,
    returns: { "1w": { stock: null, spy: null, excess: null },
               "1m": { stock: null, spy: null, excess: null },
               "3m": { stock: null, spy: null, excess: null },
               "toDate": { stock: 0.1, spy: 0.05, excess: 0.05 } },
  }],
  tickers: { NBIS: { ohlc: [{ date: "2026-06-01", o: 1, h: 2, l: 1, c: 2 }] } },
  scorecard: { totalCalls: 1, uniqueTickers: 1, hitRate: { "1m": 0, "3m": 0 },
    avgExcess: { "1w": 0, "1m": 0, "3m": 0, "toDate": 0.05 },
    callsPerWeek: 0.5, best: [], worst: [] },
  caveats: ["survivorship"],
};

test("accepts a valid dataset", () => {
  expect(() => DatasetSchema.parse(valid)).not.toThrow();
});

test("rejects a call missing ticker", () => {
  const bad = structuredClone(valid);
  // @ts-expect-error intentional
  delete bad.calls[0].ticker;
  expect(() => DatasetSchema.parse(bad)).toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/schema.test.ts`
Expected: FAIL — `DatasetSchema` does not exist.

- [ ] **Step 3: Write types.ts**

```ts
export type Horizon = "1w" | "1m" | "3m" | "toDate";
export type Direction = "bullish" | "bearish" | "neutral";

export interface OhlcBar { date: string; o: number; h: number; l: number; c: number }
export interface ReturnTriple { stock: number | null; spy: number | null; excess: number | null }

export interface Call {
  shortcode: string;
  postDate: string;            // ISO date, the signal date
  ticker: string;
  company: string;
  isFirstCall: boolean;
  conviction: number;          // 0..1
  quote: string;
  onScreenPrice?: number | null;
  returns: Record<Horizon, ReturnTriple>;
}

export interface Scorecard {
  totalCalls: number;
  uniqueTickers: number;
  hitRate: { "1m": number; "3m": number };
  avgExcess: Record<Horizon, number>;
  callsPerWeek: number;
  best: Call[];
  worst: Call[];
}

export interface Dataset {
  creator: { handle: string; name: string };
  generatedAt: string;
  spyAnchor: string;
  calls: Call[];
  tickers: Record<string, { ohlc: OhlcBar[] }>;
  scorecard: Scorecard;
  caveats: string[];
}

// Intermediate type emitted by the extract stage (pre-scoring).
export interface ReelCall {
  shortcode: string;
  postDate: string;
  ticker: string;
  company: string;
  direction: Direction;
  isExplicitBuy: boolean;
  conviction: number;
  quote: string;
  onScreenPrice: number | null;
}
```

- [ ] **Step 4: Write schema.ts**

```ts
import { z } from "zod";

const ReturnTriple = z.object({
  stock: z.number().nullable(),
  spy: z.number().nullable(),
  excess: z.number().nullable(),
});

const CallSchema = z.object({
  shortcode: z.string(),
  postDate: z.string(),
  ticker: z.string(),
  company: z.string(),
  isFirstCall: z.boolean(),
  conviction: z.number().min(0).max(1),
  quote: z.string(),
  onScreenPrice: z.number().nullable().optional(),
  returns: z.object({
    "1w": ReturnTriple, "1m": ReturnTriple, "3m": ReturnTriple, "toDate": ReturnTriple,
  }),
});

export const DatasetSchema = z.object({
  creator: z.object({ handle: z.string(), name: z.string() }),
  generatedAt: z.string(),
  spyAnchor: z.string(),
  calls: z.array(CallSchema),
  tickers: z.record(z.string(), z.object({
    ohlc: z.array(z.object({
      date: z.string(), o: z.number(), h: z.number(), l: z.number(), c: z.number(),
    })),
  })),
  scorecard: z.object({
    totalCalls: z.number(), uniqueTickers: z.number(),
    hitRate: z.object({ "1m": z.number(), "3m": z.number() }),
    avgExcess: z.object({ "1w": z.number(), "1m": z.number(), "3m": z.number(), "toDate": z.number() }),
    callsPerWeek: z.number(), best: z.array(CallSchema), worst: z.array(CallSchema),
  }),
  caveats: z.array(z.string()),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/lib/schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib
git commit -m "feat: shared dataset types and zod schema"
```

---

## Phase 2 — Scoring core (TDD)

### Task 2.1: Forward-return math

**Files:**
- Create: `influencer-tracker/src/lib/returns.ts`
- Test: `influencer-tracker/src/lib/returns.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { closeOnOrAfter, forwardReturn, computeReturns } from "./returns";
import type { OhlcBar } from "./types";

// Synthetic daily series, weekdays only (skips 06-06 Sat, 06-07 Sun).
const bars: OhlcBar[] = [
  { date: "2026-06-01", o: 100, h: 100, l: 100, c: 100 },
  { date: "2026-06-02", o: 101, h: 101, l: 101, c: 101 },
  { date: "2026-06-03", o: 102, h: 102, l: 102, c: 102 },
  { date: "2026-06-04", o: 103, h: 103, l: 103, c: 103 },
  { date: "2026-06-05", o: 104, h: 104, l: 104, c: 104 },
  { date: "2026-06-08", o: 110, h: 110, l: 110, c: 110 },
];

test("closeOnOrAfter returns same-day close when present", () => {
  expect(closeOnOrAfter(bars, "2026-06-02")).toBe(101);
});

test("closeOnOrAfter rolls forward over a weekend gap", () => {
  expect(closeOnOrAfter(bars, "2026-06-06")).toBe(110); // Sat -> Mon 06-08
});

test("closeOnOrAfter returns null past the last bar", () => {
  expect(closeOnOrAfter(bars, "2026-06-09")).toBeNull();
});

test("forwardReturn computes pct change over a calendar horizon", () => {
  // from 06-01 (100), +7 calendar days = 06-08 (110) -> 0.10
  expect(forwardReturn(bars, "2026-06-01", 7)).toBeCloseTo(0.10, 6);
});

test("forwardReturn is null when the horizon has not elapsed", () => {
  expect(forwardReturn(bars, "2026-06-05", 30)).toBeNull();
});

test("computeReturns produces excess = stock - spy per horizon", () => {
  const spy: OhlcBar[] = bars.map(b => ({ ...b, c: 100 })); // flat SPY -> 0%
  const r = computeReturns(bars, spy, "2026-06-01");
  expect(r["1w"].stock).toBeCloseTo(0.10, 6);
  expect(r["1w"].spy).toBeCloseTo(0, 6);
  expect(r["1w"].excess).toBeCloseTo(0.10, 6);
  expect(r["toDate"].stock).toBeCloseTo(0.10, 6); // last bar 110 vs 100
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/returns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement returns.ts**

```ts
import type { OhlcBar, Horizon, ReturnTriple } from "./types";

const HORIZON_DAYS: Record<Exclude<Horizon, "toDate">, number> = {
  "1w": 7, "1m": 30, "3m": 90,
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First close on a date >= target, or null if target is past the last bar. */
export function closeOnOrAfter(ohlc: OhlcBar[], target: string): number | null {
  for (const bar of ohlc) {
    if (bar.date >= target) return bar.c;
  }
  return null;
}

function pctReturn(from: number, to: number): number {
  return to / from - 1;
}

/** Pct return from `fromDate` close to (fromDate + calendarDays) close; null if not elapsed. */
export function forwardReturn(ohlc: OhlcBar[], fromDate: string, calendarDays: number): number | null {
  const start = closeOnOrAfter(ohlc, fromDate);
  if (start == null) return null;
  const end = closeOnOrAfter(ohlc, addDays(fromDate, calendarDays));
  if (end == null) return null;
  return pctReturn(start, end);
}

function toDateReturn(ohlc: OhlcBar[], fromDate: string): number | null {
  const start = closeOnOrAfter(ohlc, fromDate);
  if (start == null || ohlc.length === 0) return null;
  const last = ohlc[ohlc.length - 1].c;
  return pctReturn(start, last);
}

export function computeReturns(
  stock: OhlcBar[], spy: OhlcBar[], postDate: string,
): Record<Horizon, ReturnTriple> {
  const mk = (s: number | null, p: number | null): ReturnTriple => ({
    stock: s, spy: p, excess: s != null && p != null ? s - p : null,
  });
  return {
    "1w": mk(forwardReturn(stock, postDate, HORIZON_DAYS["1w"]), forwardReturn(spy, postDate, HORIZON_DAYS["1w"])),
    "1m": mk(forwardReturn(stock, postDate, HORIZON_DAYS["1m"]), forwardReturn(spy, postDate, HORIZON_DAYS["1m"])),
    "3m": mk(forwardReturn(stock, postDate, HORIZON_DAYS["3m"]), forwardReturn(spy, postDate, HORIZON_DAYS["3m"])),
    "toDate": mk(toDateReturn(stock, postDate), toDateReturn(spy, postDate)),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/lib/returns.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/returns.ts src/lib/returns.test.ts
git commit -m "feat: forward-return and excess-vs-spy math"
```

### Task 2.2: Dedupe + scorecard aggregation

**Files:**
- Create: `influencer-tracker/src/lib/scorecard.ts`
- Test: `influencer-tracker/src/lib/scorecard.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect } from "bun:test";
import { dedupeFirstCall, buildScorecard } from "./scorecard";
import type { Call } from "./types";

function call(over: Partial<Call>): Call {
  return {
    shortcode: "x", postDate: "2026-01-01", ticker: "AAA", company: "A",
    isFirstCall: false, conviction: 0.8, quote: "buy",
    returns: { "1w": n(), "1m": n(), "3m": n(), "toDate": n() }, ...over,
  };
  function n() { return { stock: null, spy: null, excess: null }; }
}

test("dedupeFirstCall flags earliest postDate per ticker", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-03-01" }),
    call({ ticker: "AAA", postDate: "2026-01-01" }),
    call({ ticker: "BBB", postDate: "2026-02-01" }),
  ];
  const first = dedupeFirstCall(calls).filter(c => c.isFirstCall);
  expect(first.map(c => `${c.ticker}:${c.postDate}`).sort())
    .toEqual(["AAA:2026-01-01", "BBB:2026-02-01"]);
});

test("buildScorecard averages excess over elapsed horizons only", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-01-01",
      returns: { "1w": e(0.1), "1m": e(0.2), "3m": e(0.3), "toDate": e(0.3) } }),
    call({ ticker: "BBB", postDate: "2026-01-08",
      returns: { "1w": e(-0.1), "1m": e(null), "3m": e(null), "toDate": e(-0.1) } }),
  ];
  const sc = buildScorecard(dedupeFirstCall(calls));
  expect(sc.totalCalls).toBe(2);
  expect(sc.uniqueTickers).toBe(2);
  expect(sc.avgExcess["1w"]).toBeCloseTo(0.0, 6);   // (0.1 + -0.1)/2
  expect(sc.avgExcess["1m"]).toBeCloseTo(0.2, 6);   // only AAA elapsed
  expect(sc.hitRate["1m"]).toBeCloseTo(1.0, 6);     // 1 of 1 elapsed > 0
  expect(sc.best[0].ticker).toBe("AAA");
  expect(sc.worst[0].ticker).toBe("BBB");
  function e(x: number | null) { return { stock: x, spy: 0, excess: x }; }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/scorecard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement scorecard.ts**

```ts
import type { Call, Horizon, Scorecard } from "./types";

const HORIZONS: Horizon[] = ["1w", "1m", "3m", "toDate"];

/** Returns the same calls, with isFirstCall set true on the earliest per ticker. */
export function dedupeFirstCall(calls: Call[]): Call[] {
  const earliest = new Map<string, string>();
  for (const c of calls) {
    const prev = earliest.get(c.ticker);
    if (!prev || c.postDate < prev) earliest.set(c.ticker, c.postDate);
  }
  return calls.map(c => ({ ...c, isFirstCall: earliest.get(c.ticker) === c.postDate }));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function buildScorecard(calls: Call[]): Scorecard {
  const first = calls.filter(c => c.isFirstCall);
  const avgExcess = {} as Record<Horizon, number>;
  for (const h of HORIZONS) {
    avgExcess[h] = mean(first.map(c => c.returns[h].excess).filter((x): x is number => x != null));
  }
  const hit = (h: "1m" | "3m") => {
    const elapsed = first.map(c => c.returns[h].excess).filter((x): x is number => x != null);
    return elapsed.length ? elapsed.filter(x => x > 0).length / elapsed.length : 0;
  };
  const ranked = [...first]
    .filter(c => c.returns.toDate.excess != null)
    .sort((a, b) => (b.returns.toDate.excess! - a.returns.toDate.excess!));
  const spanDays = first.length
    ? (new Date(maxDate(first)).getTime() - new Date(minDate(first)).getTime()) / 86400000
    : 0;
  const weeks = Math.max(spanDays / 7, 1);
  return {
    totalCalls: calls.length,
    uniqueTickers: new Set(calls.map(c => c.ticker)).size,
    hitRate: { "1m": hit("1m"), "3m": hit("3m") },
    avgExcess,
    callsPerWeek: first.length / weeks,
    best: ranked.slice(0, 5),
    worst: ranked.slice(-5).reverse(),
  };
}

function minDate(cs: Call[]): string { return cs.reduce((m, c) => c.postDate < m ? c.postDate : m, cs[0].postDate); }
function maxDate(cs: Call[]): string { return cs.reduce((m, c) => c.postDate > m ? c.postDate : m, cs[0].postDate); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/lib/scorecard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scorecard.ts src/lib/scorecard.test.ts
git commit -m "feat: dedupe-first-call and scorecard aggregation"
```

---

## Phase 3 — Pipeline (I/O stages)

> These stages call external services (Instagram, Groq, Yahoo). They are verified
> by running against the NBIS fixture and asserting output file shape, not by pure
> unit tests. Every stage is idempotent: it skips work when its cached output for a
> shortcode already exists. No fabricated data — on failure, log and skip the item.

### Task 3.0: Config + Groq model discovery + paths

**Files:**
- Create: `influencer-tracker/pipeline/config.ts`
- Create: `influencer-tracker/pipeline/groq.ts`
- Create: `influencer-tracker/.env.example`

- [ ] **Step 1: Write `.env.example`**

```
GROQ_API_KEY=gsk_xxx
```

- [ ] **Step 2: Write config.ts (paths + handles)**

```ts
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const DATA = join(ROOT, "data", "creators");

export function creatorDir(handle: string) { return join(DATA, handle); }
export function rawDir(handle: string) { return join(creatorDir(handle), "raw"); }
export function transcriptsDir(handle: string) { return join(creatorDir(handle), "transcripts"); }
export function framesDir(handle: string) { return join(creatorDir(handle), "frames"); }
export function pricesDir(handle: string) { return join(creatorDir(handle), "prices"); }

export const GROQ_KEY = process.env.GROQ_API_KEY ?? "";
if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set (see .env.example)");
```

- [ ] **Step 3: Write groq.ts with runtime model discovery**

```ts
import { GROQ_KEY } from "./config";

const BASE = "https://api.groq.com/openai/v1";

async function groq(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${GROQ_KEY}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Groq ${path} ${res.status}: ${await res.text()}`);
  return res;
}

/** Pick the current STT, vision, and text model ids from /models (avoids stale hardcoding). */
export async function discoverModels() {
  const { data } = await (await groq("/models")).json() as { data: { id: string }[] };
  const ids = data.map(m => m.id);
  const pick = (subs: string[]) => ids.find(id => subs.every(s => id.includes(s)));
  const stt = ids.find(id => id.includes("whisper")) ?? "whisper-large-v3";
  const vision = pick(["llama", "vision"]) ?? pick(["scout"]) ?? pick(["maverick"]) ?? "";
  const text = pick(["llama", "70b"]) ?? pick(["llama-3.3"]) ?? pick(["versatile"]) ?? "";
  if (!vision || !text) throw new Error(`Could not resolve Groq models from: ${ids.join(", ")}`);
  return { stt, vision, text };
}

export { groq };
```

- [ ] **Step 4: Verify model discovery against the live API**

Run from `influencer-tracker/` (with `GROQ_API_KEY` exported):
```bash
bun -e 'import("./pipeline/groq").then(m=>m.discoverModels()).then(console.log)'
```
Expected: an object like `{ stt: "whisper-large-v3", vision: "...", text: "..." }` with non-empty values. Record them.

- [ ] **Step 5: Commit**

```bash
git add pipeline/config.ts pipeline/groq.ts .env.example
git commit -m "feat: pipeline config and groq model discovery"
```

### Task 3.1: Scrape stage (Playwright + stealth)

**Files:**
- Create: `influencer-tracker/pipeline/scrape.ts`

- [ ] **Step 1: Implement scrape.ts**

```ts
// Browser-driven scrape of a creator's reels in the last `months` months.
// Stealth: real Chromium, human-like delays, harvest shortcodes+dates from
// intercepted GraphQL, then download each video with yt-dlp.
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawDir } from "./config";

chromium.use(stealth());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

export async function scrape(handle: string, months = 12, userDataDir = ".chrome-profile") {
  const cutoff = Date.now() - months * 30 * 86400_000;
  const ctx = await chromium.launchPersistentContext(userDataDir, { headless: false });
  const page = await ctx.newPage();

  const seen = new Map<string, number>(); // shortcode -> taken_at (epoch ms)
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/graphql") && !url.includes("/api/v1/")) return;
    try {
      const json: any = await res.json();
      for (const node of findReels(json)) {
        if (node.code) seen.set(node.code, (node.taken_at ?? 0) * 1000);
      }
    } catch { /* non-JSON response */ }
  });

  await page.goto(`https://www.instagram.com/${handle}/reels/`, { waitUntil: "domcontentloaded" });
  // Human-like scroll until we pass the cutoff date or stop finding new reels.
  let stagnant = 0;
  while (stagnant < 4) {
    const before = seen.size;
    await page.mouse.wheel(0, 1200 + jitter(0, 800));
    await sleep(jitter(1500, 3500));
    const oldest = Math.min(...[...seen.values()].filter(Boolean), Date.now());
    if (oldest < cutoff) break;
    stagnant = seen.size === before ? stagnant + 1 : 0;
  }
  await ctx.close();

  const recent = [...seen.entries()].filter(([, t]) => !t || t >= cutoff).map(([code]) => code);
  await mkdir(rawDir(handle), { recursive: true });
  await writeFile(join(rawDir(handle), "shortcodes.json"), JSON.stringify(recent, null, 2));
  return recent;
}

// Recursively find objects that look like reel media nodes.
function* findReels(obj: any): Generator<any> {
  if (!obj || typeof obj !== "object") return;
  if (typeof obj.code === "string" && ("taken_at" in obj || "media_type" in obj)) yield obj;
  for (const v of Object.values(obj)) yield* findReels(v);
}
```

- [ ] **Step 2: Implement the per-reel downloader (yt-dlp) — append to scrape.ts**

```ts
import { spawnSync } from "node:child_process";

export function downloadReel(handle: string, shortcode: string): boolean {
  const out = join(rawDir(handle), shortcode);
  const url = `https://www.instagram.com/reel/${shortcode}/`;
  const r = spawnSync("yt-dlp", [
    "--cookies-from-browser", "chrome",
    "-o", join(out, "reel.%(ext)s"),
    "--write-info-json", url,
  ], { stdio: "inherit" });
  return r.status === 0;
}
```

- [ ] **Step 3: Smoke-verify against @kevvonz (manual, headful)**

Run from `influencer-tracker/`:
```bash
bun -e 'import("./pipeline/scrape").then(async m=>{const c=await m.scrape("kevvonz",1);console.log("found",c.length);})'
```
Expected: a non-empty `data/creators/kevvonz/raw/shortcodes.json`. (Requires you to be logged into Instagram in the launched Chromium profile; log in once when the window opens.)

> NOTE: Instagram's response shape drifts. If `found 0`, open the saved HAR/console
> and adjust `findReels` to match the current GraphQL node shape before proceeding.
> Fallback per spec: accept a hand-supplied list of reel URLs.

- [ ] **Step 4: Commit**

```bash
git add pipeline/scrape.ts
git commit -m "feat: playwright stealth scrape + yt-dlp reel downloader"
```

### Task 3.2: Transcribe stage

**Files:**
- Create: `influencer-tracker/pipeline/transcribe.ts`

- [ ] **Step 1: Implement transcribe.ts**

```ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, transcriptsDir } from "./config";
import { groq, discoverModels } from "./groq";

async function transcribeOne(stt: string, videoPath: string): Promise<any> {
  const mp3 = videoPath.replace(/\.[^.]+$/, ".mp3");
  spawnSync("ffmpeg", ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", mp3], { stdio: "ignore" });
  const fd = new FormData();
  fd.append("file", new Blob([await readFile(mp3)]), "audio.mp3");
  fd.append("model", stt);
  fd.append("response_format", "verbose_json");
  return (await groq("/audio/transcriptions", { method: "POST", body: fd })).json();
}

export async function transcribe(handle: string) {
  const { stt } = await discoverModels();
  await mkdir(transcriptsDir(handle), { recursive: true });
  const codes = await readdir(rawDir(handle), { withFileTypes: true });
  for (const d of codes) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    const outPath = join(transcriptsDir(handle), `${code}.json`);
    if (existsSync(outPath)) continue; // idempotent
    const dir = join(rawDir(handle), code);
    const files = await readdir(dir);
    const video = files.find(f => /\.(mp4|webm|mkv)$/.test(f));
    if (!video) { console.warn(`skip ${code}: no video`); continue; }
    const t = await transcribeOne(stt, join(dir, video));
    await writeFile(outPath, JSON.stringify({ shortcode: code, text: t.text, segments: t.segments }, null, 2));
    console.log(`transcribed ${code}`);
  }
}
```

- [ ] **Step 2: Smoke-verify with the known fixture**

Run from `influencer-tracker/`:
```bash
mkdir -p data/creators/kevvonz/raw/DZDmQutB0Ep && cp /tmp/reel/reel.mp4 data/creators/kevvonz/raw/DZDmQutB0Ep/
bun -e 'import("./pipeline/transcribe").then(m=>m.transcribe("kevvonz"))'
cat data/creators/kevvonz/transcripts/DZDmQutB0Ep.json | head -c 200
```
Expected: transcript JSON containing the word "Nebius" / "nebious".

- [ ] **Step 3: Commit**

```bash
git add pipeline/transcribe.ts
git commit -m "feat: groq whisper transcription stage"
```

### Task 3.3: Frames (vision) stage

**Files:**
- Create: `influencer-tracker/pipeline/frames.ts`

- [ ] **Step 1: Implement frames.ts**

```ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir, framesDir } from "./config";
import { groq, discoverModels } from "./groq";

const PROMPT =
  "This is a frame from a stock-picker's video. Read any on-screen stock ticker " +
  "symbol and any displayed price. Reply as compact JSON: " +
  '{"ticker": string|null, "price": number|null}. No prose.';

async function readFrame(vision: string, imgPath: string) {
  const b64 = (await readFile(imgPath)).toString("base64");
  const body = {
    model: vision,
    messages: [{ role: "user", content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
    ] }],
    temperature: 0,
  };
  const r = await (await groq("/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).json();
  try { return JSON.parse(r.choices[0].message.content.replace(/```json|```/g, "")); }
  catch { return { ticker: null, price: null }; }
}

export async function frames(handle: string) {
  const { vision } = await discoverModels();
  await mkdir(framesDir(handle), { recursive: true });
  for (const d of await readdir(rawDir(handle), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const code = d.name;
    const out = join(framesDir(handle), `${code}.json`);
    if (existsSync(out)) continue;
    const dir = join(rawDir(handle), code);
    const video = (await readdir(dir)).find(f => /\.(mp4|webm|mkv)$/.test(f));
    if (!video) continue;
    // sample 3 frames at 25%, 50%, 75% of duration
    const hints: any[] = [];
    for (const pct of [0.25, 0.5, 0.75]) {
      const img = join(dir, `f_${pct}.jpg`);
      spawnSync("ffmpeg", ["-y", "-ss", String(pct * 60), "-i", join(dir, video), "-frames:v", "1", img], { stdio: "ignore" });
      if (existsSync(img)) hints.push(await readFrame(vision, img));
    }
    await writeFile(out, JSON.stringify({ shortcode: code, hints }, null, 2));
    console.log(`frames ${code}:`, hints);
  }
}
```

- [ ] **Step 2: Smoke-verify with the fixture**

Run from `influencer-tracker/`:
```bash
bun -e 'import("./pipeline/frames").then(m=>m.frames("kevvonz"))'
cat data/creators/kevvonz/frames/DZDmQutB0Ep.json
```
Expected: at least one hint with `"ticker": "NBIS"`.

- [ ] **Step 3: Commit**

```bash
git add pipeline/frames.ts
git commit -m "feat: groq vision on-screen ticker/price extraction"
```

### Task 3.4: Extract stage (LLM → bullish calls)

**Files:**
- Create: `influencer-tracker/pipeline/extract.ts`

- [ ] **Step 1: Implement extract.ts**

```ts
import { existsSync } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { creatorDir, transcriptsDir, framesDir, rawDir } from "./config";
import { groq, discoverModels } from "./groq";
import type { ReelCall } from "../src/lib/types";

const SYS =
  "You analyze a stock-influencer reel. Decide if it makes an EXPLICIT BULLISH call " +
  "(names a ticker AND tells viewers to buy/hold it). Use the transcript, caption, and " +
  "on-screen hints (the hints are authoritative for the exact ticker symbol). " +
  'Reply ONLY JSON: {"ticker":string|null,"company":string|null,"direction":"bullish"|"bearish"|"neutral",' +
  '"isExplicitBuy":boolean,"conviction":number,"quote":string,"onScreenPrice":number|null}. ' +
  "ticker null if no specific stock. conviction 0..1.";

async function postDateOf(handle: string, code: string): Promise<string> {
  // yt-dlp info json: upload_date YYYYMMDD
  const dir = join(rawDir(handle), code);
  const info = (await readdir(dir)).find(f => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    if (j.upload_date) return `${j.upload_date.slice(0,4)}-${j.upload_date.slice(4,6)}-${j.upload_date.slice(6,8)}`;
  }
  return new Date().toISOString().slice(0, 10);
}

export async function extract(handle: string) {
  const { text } = await discoverModels();
  const out: ReelCall[] = [];
  for (const f of await readdir(transcriptsDir(handle))) {
    if (!f.endsWith(".json")) continue;
    const code = f.replace(".json", "");
    const tr = JSON.parse(await readFile(join(transcriptsDir(handle), f), "utf8"));
    const fp = join(framesDir(handle), f);
    const hints = existsSync(fp) ? JSON.parse(await readFile(fp, "utf8")).hints : [];
    const user = `TRANSCRIPT:\n${tr.text}\n\nON-SCREEN HINTS:\n${JSON.stringify(hints)}`;
    const r = await (await groq("/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: text, temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYS }, { role: "user", content: user }] }),
    })).json();
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.ticker) continue;
    out.push({ shortcode: code, postDate: await postDateOf(handle, code),
      ticker: String(parsed.ticker).toUpperCase(), company: parsed.company ?? "",
      direction: parsed.direction ?? "neutral", isExplicitBuy: !!parsed.isExplicitBuy,
      conviction: Number(parsed.conviction ?? 0), quote: parsed.quote ?? "",
      onScreenPrice: parsed.onScreenPrice ?? null });
  }
  await writeFile(join(creatorDir(handle), "reel-calls.json"), JSON.stringify(out, null, 2));
  await writeReview(handle, out);
  return out;
}

async function writeReview(handle: string, calls: ReelCall[]) {
  const bullish = calls.filter(c => c.isExplicitBuy && c.direction === "bullish");
  const lines = ["# Calls review — verify before scoring", "",
    `Total reels with a ticker: ${calls.length}. Explicit bullish calls: ${bullish.length}.`, "",
    "| date | ticker | buy? | dir | conv | quote |", "|---|---|---|---|---|---|",
    ...calls.sort((a,b)=>a.postDate.localeCompare(b.postDate)).map(c =>
      `| ${c.postDate} | ${c.ticker} | ${c.isExplicitBuy?"✅":""} | ${c.direction} | ${c.conviction} | ${c.quote.replace(/\|/g," ").slice(0,60)} |`)];
  await writeFile(join(creatorDir(handle), "calls.review.md"), lines.join("\n"));
}
```

- [ ] **Step 2: Smoke-verify with the fixture**

Run from `influencer-tracker/`:
```bash
bun -e 'import("./pipeline/extract").then(m=>m.extract("kevvonz"))'
cat data/creators/kevvonz/calls.review.md
```
Expected: a row for `NBIS` with `✅` buy and `bullish` direction.

- [ ] **Step 3: Commit**

```bash
git add pipeline/extract.ts
git commit -m "feat: llm extraction of explicit bullish calls + review file"
```

### Task 3.5: Prices stage

**Files:**
- Create: `influencer-tracker/pipeline/prices.ts`

- [ ] **Step 1: Implement prices.ts**

```ts
import yahooFinance from "yahoo-finance2";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir } from "./config";
import type { OhlcBar, ReelCall } from "../src/lib/types";

async function fetchOhlc(symbol: string, from: string): Promise<OhlcBar[]> {
  const rows = await yahooFinance.chart(symbol, { period1: from, interval: "1d" });
  return rows.quotes
    .filter(q => q.open != null && q.close != null)
    .map(q => ({ date: new Date(q.date).toISOString().slice(0,10),
      o: q.open!, h: q.high!, l: q.low!, c: q.close! }));
}

export async function prices(handle: string) {
  await mkdir(pricesDir(handle), { recursive: true });
  const calls: ReelCall[] = JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"));
  const tickers = [...new Set(calls.map(c => c.ticker)), "SPY"];
  const from = calls.reduce((m, c) => c.postDate < m ? c.postDate : m, calls[0]?.postDate ?? "2025-01-01");
  for (const t of tickers) {
    const out = join(pricesDir(handle), `${t}.json`);
    if (existsSync(out)) continue;
    try {
      const ohlc = await fetchOhlc(t, from);
      if (!ohlc.length) { console.warn(`FLAG ${t}: no price data`); continue; }
      await writeFile(out, JSON.stringify(ohlc));
      console.log(`prices ${t}: ${ohlc.length} bars`);
    } catch (e) { console.warn(`FLAG ${t}: ${(e as Error).message}`); }
  }
}
```

- [ ] **Step 2: Smoke-verify**

Run from `influencer-tracker/`:
```bash
bun -e 'import("./pipeline/prices").then(m=>m.prices("kevvonz"))'
ls data/creators/kevvonz/prices
```
Expected: `NBIS.json` and `SPY.json` exist with many bars.

- [ ] **Step 3: Commit**

```bash
git add pipeline/prices.ts
git commit -m "feat: yahoo-finance price fetch stage"
```

### Task 3.6: Score stage → dataset.json + index.json

**Files:**
- Create: `influencer-tracker/pipeline/score.ts`
- Test: `influencer-tracker/pipeline/score.test.ts`

- [ ] **Step 1: Write the failing test (assembly logic)**

```ts
import { test, expect } from "bun:test";
import { assembleDataset } from "./score";
import type { ReelCall, OhlcBar } from "../src/lib/types";

test("assembleDataset scores calls and validates against schema", () => {
  const reelCalls: ReelCall[] = [{
    shortcode: "DZDmQutB0Ep", postDate: "2026-06-01", ticker: "NBIS",
    company: "Nebius Group N.V.", direction: "bullish", isExplicitBuy: true,
    conviction: 0.9, quote: "buy right here", onScreenPrice: 273.01,
  }];
  const nbis: OhlcBar[] = [
    { date: "2026-06-01", o: 100, h: 100, l: 100, c: 100 },
    { date: "2026-06-08", o: 110, h: 110, l: 110, c: 110 },
  ];
  const spy: OhlcBar[] = [
    { date: "2026-06-01", o: 50, h: 50, l: 50, c: 50 },
    { date: "2026-06-08", o: 50, h: 50, l: 50, c: 50 },
  ];
  const ds = assembleDataset({ handle: "kevvonz", name: "Kevin Hu" },
    reelCalls, { NBIS: nbis, SPY: spy }, "2026-06-09");
  expect(ds.calls[0].isFirstCall).toBe(true);
  expect(ds.calls[0].returns["1w"].excess).toBeCloseTo(0.10, 6);
  expect(ds.scorecard.totalCalls).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test pipeline/score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement score.ts**

```ts
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir, DATA } from "./config";
import { computeReturns } from "../src/lib/returns";
import { dedupeFirstCall, buildScorecard } from "../src/lib/scorecard";
import { DatasetSchema } from "../src/lib/schema";
import type { Dataset, ReelCall, OhlcBar, Call } from "../src/lib/types";

const CAVEATS = ["survivorship", "reposts-deduped", "forward-from-post-date"];

export function assembleDataset(
  creator: { handle: string; name: string },
  reelCalls: ReelCall[],
  ohlc: Record<string, OhlcBar[]>,
  generatedAt: string,
): Dataset {
  const spy = ohlc["SPY"] ?? [];
  const bullish = reelCalls.filter(c => c.isExplicitBuy && c.direction === "bullish");
  let calls: Call[] = bullish.map(c => ({
    shortcode: c.shortcode, postDate: c.postDate, ticker: c.ticker, company: c.company,
    isFirstCall: false, conviction: c.conviction, quote: c.quote, onScreenPrice: c.onScreenPrice,
    returns: computeReturns(ohlc[c.ticker] ?? [], spy, c.postDate),
  }));
  calls = dedupeFirstCall(calls);
  const tickers: Record<string, { ohlc: OhlcBar[] }> = {};
  for (const t of [...new Set(calls.map(c => c.ticker)), "SPY"]) tickers[t] = { ohlc: ohlc[t] ?? [] };
  const ds: Dataset = {
    creator, generatedAt, spyAnchor: "SPY", calls, tickers,
    scorecard: buildScorecard(calls), caveats: CAVEATS,
  };
  DatasetSchema.parse(ds); // fail-closed on a malformed dataset
  return ds;
}

export async function score(handle: string, name: string, today = new Date().toISOString().slice(0,10)) {
  const reelCalls: ReelCall[] = JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"));
  const ohlc: Record<string, OhlcBar[]> = {};
  for (const f of await readdir(pricesDir(handle))) {
    if (f.endsWith(".json")) ohlc[f.replace(".json","")] = JSON.parse(await readFile(join(pricesDir(handle), f), "utf8"));
  }
  const ds = assembleDataset({ handle, name }, reelCalls, ohlc, today);
  await writeFile(join(creatorDir(handle), "dataset.json"), JSON.stringify(ds, null, 2));
  await updateIndex(handle, name, ds);
  return ds;
}

async function updateIndex(handle: string, name: string, ds: Dataset) {
  const path = join(DATA, "index.json");
  const idx: any[] = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : [];
  const entry = { handle, name, totalCalls: ds.scorecard.totalCalls,
    avgExcess3m: ds.scorecard.avgExcess["3m"], generatedAt: ds.generatedAt };
  const i = idx.findIndex(e => e.handle === handle);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  await mkdir(DATA, { recursive: true });
  await writeFile(path, JSON.stringify(idx, null, 2));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test pipeline/score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/score.ts pipeline/score.test.ts
git commit -m "feat: score stage assembling validated dataset.json + index"
```

### Task 3.7: Pipeline orchestrator CLI

**Files:**
- Create: `influencer-tracker/pipeline/run.ts`
- Modify: `influencer-tracker/package.json` (add `"pipeline"` script)

- [ ] **Step 1: Implement run.ts**

```ts
import { scrape, downloadReel } from "./scrape";
import { transcribe } from "./transcribe";
import { frames } from "./frames";
import { extract } from "./extract";
import { prices } from "./prices";
import { score } from "./score";

// Usage: bun run pipeline --handle kevvonz --name "Kevin Hu" [--from <stage>]
const args = Object.fromEntries(process.argv.slice(2).flatMap((a,i,arr)=>a.startsWith("--")?[[a.slice(2),arr[i+1]]]:[]));
const handle = args.handle; const name = args.name ?? handle;
if (!handle) throw new Error("--handle required");
const stages = ["scrape","transcribe","frames","extract","prices","score"];
const start = args.from ? stages.indexOf(args.from) : 0;

for (const stage of stages.slice(start)) {
  console.log(`\n=== ${stage} ===`);
  if (stage === "scrape") { const codes = await scrape(handle); for (const c of codes) downloadReel(handle, c); }
  else if (stage === "transcribe") await transcribe(handle);
  else if (stage === "frames") await frames(handle);
  else if (stage === "extract") { await extract(handle); console.log("PAUSE: review calls.review.md then re-run with --from prices"); break; }
  else if (stage === "prices") await prices(handle);
  else if (stage === "score") await score(handle, name);
}
```

- [ ] **Step 2: Add the package.json script**

In `influencer-tracker/package.json` `"scripts"`, add:
```json
"pipeline": "bun run pipeline/run.ts"
```

- [ ] **Step 3: Verify the orchestrator wiring (resume path) with the fixture**

Run from `influencer-tracker/`:
```bash
bun run pipeline --handle kevvonz --name "Kevin Hu" --from prices
cat data/creators/kevvonz/dataset.json | head -c 300
```
Expected: a valid `dataset.json` with the NBIS call scored (assuming Tasks 3.2–3.4 fixture outputs exist).

- [ ] **Step 4: Commit**

```bash
git add pipeline/run.ts package.json
git commit -m "feat: pipeline orchestrator CLI with stage resume"
```

### Task 3.8: Ignore scraped data and browser profile

**Files:**
- Create: `influencer-tracker/.gitignore`

- [ ] **Step 1: Write .gitignore**

```
node_modules
data/creators
.chrome-profile
.env
dist
.output
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore scraped data, browser profile, env"
```

---

## Phase 4 — Dashboard

> The dashboard reads `data/creators/<handle>/dataset.json` and `data/creators/index.json`.
> Use a TanStack Start server function (runs server-side, can read the filesystem) to
> load these. Verify each route renders with the real NBIS dataset produced in Phase 3.
>
> **bklit chart import ground-truth (confirmed in Task 1.2):** there is NO barrel
> export. Each chart is its own file under `src/components/charts/`, imported via the
> `#/*` alias — e.g. `import { LineChart, Line } from "#/components/charts/line-chart"`,
> `Grid` from `#/components/charts/grid`, `XAxis` from `#/components/charts/x-axis`,
> `ChartTooltip` from `#/components/charts/tooltip`. Implementers MUST open the
> generated chart file to confirm the exact exported symbol names before importing.
> shadcn primitives are at `#/components/ui/<name>`.

### Task 4.1: Data loaders (server functions)

**Files:**
- Create: `influencer-tracker/src/lib/data.ts`

- [ ] **Step 1: Implement loaders**

```ts
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatasetSchema } from "./schema";
import type { Dataset } from "./types";

const DATA = join(process.cwd(), "data", "creators");

export const listCreators = createServerFn({ method: "GET" }).handler(async () => {
  try { return JSON.parse(await readFile(join(DATA, "index.json"), "utf8")) as
    { handle: string; name: string; totalCalls: number; avgExcess3m: number; generatedAt: string }[]; }
  catch { return []; }
});

export const getDataset = createServerFn({ method: "GET" })
  .validator((handle: string) => handle)
  .handler(async ({ data: handle }): Promise<Dataset> => {
    const raw = JSON.parse(await readFile(join(DATA, handle, "dataset.json"), "utf8"));
    return DatasetSchema.parse(raw);
  });
```

- [ ] **Step 2: Type-check**

Run from `influencer-tracker/`: `bunx tsc --noEmit`
Expected: no errors. (Adjust the `@tanstack/react-start` import to match the scaffolded version if tsc flags it.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat: server-fn dataset loaders"
```

### Task 4.2: Landing route (creator list)

**Files:**
- Create: `influencer-tracker/src/routes/index.tsx`

- [ ] **Step 1: Implement the landing route**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { listCreators } from "../lib/data";
import { Card } from "../components/ui/card";

export const Route = createFileRoute("/")({
  loader: () => listCreators(),
  component: Landing,
});

function Landing() {
  const creators = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold mb-6">Influencer Signal Tracker</h1>
      {creators.length === 0 && <p className="text-muted-foreground">No creators yet. Run the pipeline.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {creators.map(c => (
          <Link key={c.handle} to="/c/$handle" params={{ handle: c.handle }}>
            <Card className="p-4 hover:bg-accent">
              <div className="font-semibold">@{c.handle}</div>
              <div className="text-sm text-muted-foreground">{c.name}</div>
              <div className="mt-2 text-sm">{c.totalCalls} calls · 3m excess vs SPY:{" "}
                <span className={c.avgExcess3m >= 0 ? "text-green-600" : "text-red-600"}>
                  {(c.avgExcess3m * 100).toFixed(1)}%</span></div>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run from `influencer-tracker/`: `bun run dev`, open `localhost:3000`.
Expected: a card for `@kevvonz` showing the call count and 3m excess. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: landing route with creator list"
```

### Task 4.3: Caveats banner + scorecard components

**Files:**
- Create: `influencer-tracker/src/components/CaveatsBanner.tsx`
- Create: `influencer-tracker/src/components/Scorecard.tsx`

- [ ] **Step 1: Implement CaveatsBanner.tsx**

```tsx
const TEXT: Record<string, string> = {
  survivorship: "Deleted losing-call reels can't be scraped — accuracy shown is an upper bound.",
  "reposts-deduped": "Repeated promotions are counted once (first bullish mention per ticker).",
  "forward-from-post-date": "Returns are measured from each reel's post date forward — not the gains he brags about.",
};
export function CaveatsBanner({ caveats }: { caveats: string[] }) {
  return (
    <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
      <div className="font-semibold mb-1">How to read this</div>
      <ul className="list-disc pl-5 space-y-0.5">
        {caveats.map(c => <li key={c}>{TEXT[c] ?? c}</li>)}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Implement Scorecard.tsx**

```tsx
import type { Scorecard as SC } from "../lib/types";
import { Card } from "./ui/card";

function pct(x: number) { return `${(x * 100).toFixed(1)}%`; }

export function Scorecard({ sc }: { sc: SC }) {
  const stats = [
    ["Total calls", String(sc.totalCalls)],
    ["Unique tickers", String(sc.uniqueTickers)],
    ["Calls / week", sc.callsPerWeek.toFixed(1)],
    ["Hit rate 1m (beats SPY)", pct(sc.hitRate["1m"])],
    ["Hit rate 3m (beats SPY)", pct(sc.hitRate["3m"])],
    ["Avg excess 1m", pct(sc.avgExcess["1m"])],
    ["Avg excess 3m", pct(sc.avgExcess["3m"])],
    ["Avg excess to date", pct(sc.avgExcess["toDate"])],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(([label, val]) => (
        <Card key={label} className="p-3">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">{val}</div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Type-check and commit**

```bash
bunx tsc --noEmit
git add src/components/CaveatsBanner.tsx src/components/Scorecard.tsx
git commit -m "feat: caveats banner and scorecard components"
```

### Task 4.4: Creator overview route (scorecard + timeline)

**Files:**
- Create: `influencer-tracker/src/routes/c.$handle.tsx`
- Create: `influencer-tracker/src/components/Timeline.tsx`

- [ ] **Step 1: Implement Timeline.tsx (calls colored by since-call excess)**

```tsx
import { Link } from "@tanstack/react-router";
import type { Call } from "../lib/types";

export function Timeline({ handle, calls }: { handle: string; calls: Call[] }) {
  const sorted = [...calls].sort((a, b) => a.postDate.localeCompare(b.postDate));
  const t0 = new Date(sorted[0]?.postDate ?? Date.now()).getTime();
  const t1 = new Date(sorted.at(-1)?.postDate ?? Date.now()).getTime();
  const span = Math.max(t1 - t0, 1);
  return (
    <div className="relative h-24 w-full rounded-md border bg-card">
      {sorted.map((c, i) => {
        const x = ((new Date(c.postDate).getTime() - t0) / span) * 96 + 2;
        const ex = c.returns.toDate.excess;
        const color = ex == null ? "bg-muted" : ex >= 0 ? "bg-green-500" : "bg-red-500";
        return (
          <Link key={c.shortcode + i} to="/c/$handle/ticker/$symbol"
            params={{ handle, symbol: c.ticker }}
            className={`absolute top-1/2 -translate-y-1/2 size-3 rounded-full ${color} ring-2 ring-background`}
            style={{ left: `${x}%` }} title={`${c.ticker} ${c.postDate} ${ex != null ? (ex*100).toFixed(0)+"% vs SPY" : "pending"}`} />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Implement the overview route**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getDataset } from "../lib/data";
import { CaveatsBanner } from "../components/CaveatsBanner";
import { Scorecard } from "../components/Scorecard";
import { Timeline } from "../components/Timeline";

export const Route = createFileRoute("/c/$handle")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  component: Overview,
});

function Overview() {
  const ds = Route.useLoaderData();
  const { handle } = Route.useParams();
  return (
    <main className="mx-auto max-w-5xl p-8 space-y-6">
      <header><h1 className="text-2xl font-bold">@{ds.creator.handle}</h1>
        <p className="text-muted-foreground">{ds.creator.name} · as of {ds.generatedAt}</p></header>
      <CaveatsBanner caveats={ds.caveats} />
      <Scorecard sc={ds.scorecard} />
      <section><h2 className="font-semibold mb-2">Calls timeline</h2>
        <Timeline handle={handle} calls={ds.calls} /></section>
    </main>
  );
}
```

- [ ] **Step 3: Verify rendering**

Run `bun run dev`, open `localhost:3000/c/kevvonz`.
Expected: scorecard cards, caveats banner, and a timeline dot for NBIS. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/routes/c.\$handle.tsx src/components/Timeline.tsx
git commit -m "feat: creator overview route with scorecard and timeline"
```

### Task 4.5: Ticker detail route (price chart + call markers)

**Files:**
- Create: `influencer-tracker/src/routes/c.$handle.ticker.$symbol.tsx`

- [ ] **Step 1: Implement the ticker route**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { getDataset } from "../lib/data";
// bklit charts: no barrel — import each from its file (verify exact symbols by reading the files).
import { CandlestickChart, Candlestick } from "#/components/charts/candlestick-chart";
import { LineChart, Line } from "#/components/charts/line-chart";
import { Grid } from "#/components/charts/grid";
import { XAxis } from "#/components/charts/x-axis";
import { ChartTooltip } from "#/components/charts/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table";

export const Route = createFileRoute("/c/$handle/ticker/$symbol")({
  loader: ({ params }) => getDataset({ data: params.handle }),
  component: TickerPage,
});

function pct(x: number | null) { return x == null ? "—" : `${(x * 100).toFixed(1)}%`; }

function TickerPage() {
  const ds = Route.useLoaderData();
  const { symbol } = Route.useParams();
  const ohlc = ds.tickers[symbol]?.ohlc ?? [];
  const spy = ds.tickers["SPY"]?.ohlc ?? [];
  const calls = ds.calls.filter(c => c.ticker === symbol);
  const callDates = new Set(calls.map(c => c.postDate));

  // Candlestick price action (data shape: Date + open/high/low/close).
  const candles = ohlc.map(b => ({ date: new Date(b.date), open: b.o, high: b.h, low: b.l, close: b.c }));

  // Stock vs SPY rebased to 100 at the first bar, with call points marked.
  const base = ohlc[0]?.c ?? 1;
  const spyBase = spy[0]?.c ?? 1;
  const spyByDate = new Map(spy.map(b => [b.date, b.c]));
  const norm = ohlc.map(b => ({
    date: new Date(b.date),
    stock: (b.c / base) * 100,
    spy: spyByDate.has(b.date) ? (spyByDate.get(b.date)! / spyBase) * 100 : null,
    call: callDates.has(b.date) ? (b.c / base) * 100 : null,
  }));

  return (
    <main className="mx-auto max-w-5xl p-8 space-y-6">
      <h1 className="text-2xl font-bold">{symbol} <span className="text-muted-foreground text-base">{calls[0]?.company}</span></h1>
      <section>
        <h2 className="font-semibold mb-2">Price</h2>
        <CandlestickChart data={candles} style={{ height: 320 }}>
          <Grid horizontal />
          <Candlestick fadedOpacity={0.25} />
          <XAxis />
          <ChartTooltip />
        </CandlestickChart>
      </section>
      <section>
        <h2 className="font-semibold mb-2">Stock vs SPY, rebased to 100 — markers are his call dates</h2>
        <LineChart data={norm}>
          <Grid horizontal highlightRowValues={[100]} />
          <Line dataKey="stock" />
          <Line dataKey="spy" stroke="var(--chart-3)" />
          <Line dataKey="call" showMarkers stroke="transparent" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </section>
      <section>
        <h2 className="font-semibold mb-2">Calls & forward return vs SPY</h2>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>1w</TableHead><TableHead>1m</TableHead>
            <TableHead>3m</TableHead><TableHead>To date</TableHead><TableHead>Quote</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {calls.map(c => (
              <TableRow key={c.shortcode}>
                <TableCell>{c.postDate}{c.isFirstCall ? " ⭐" : ""}</TableCell>
                <TableCell>{pct(c.returns["1w"].excess)}</TableCell>
                <TableCell>{pct(c.returns["1m"].excess)}</TableCell>
                <TableCell>{pct(c.returns["3m"].excess)}</TableCell>
                <TableCell>{pct(c.returns["toDate"].excess)}</TableCell>
                <TableCell className="max-w-xs truncate">{c.quote}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify rendering**

Run `bun run dev`, open `localhost:3000/c/kevvonz/ticker/NBIS`.
Expected: a line chart of NBIS with a marker on the call date, and a returns table row (excess vs SPY per horizon). Stop the server.

- [ ] **Step 3: Commit**

```bash
git add 'src/routes/c.$handle.ticker.$symbol.tsx'
git commit -m "feat: ticker detail route with price chart and returns table"
```

### Task 4.7: Analytics charts on overview (gauge, bar, scatter, funnel)

**Files:**
- Modify: `influencer-tracker/src/lib/types.ts` (add optional funnel)
- Modify: `influencer-tracker/src/lib/schema.ts` (add optional funnel)
- Modify: `influencer-tracker/pipeline/score.ts` (populate funnel counts)
- Create: `influencer-tracker/src/components/AnalyticsCharts.tsx`
- Modify: `influencer-tracker/src/routes/c.$handle.tsx` (render AnalyticsCharts)

- [ ] **Step 1: Add an optional funnel field to types.ts**

Add to `src/lib/types.ts`:
```ts
export interface FunnelStage { label: string; value: number }
```
And add this line inside the `Scorecard` interface (optional, so existing tests/data stay valid):
```ts
  funnel?: FunnelStage[];
```

- [ ] **Step 2: Add the optional funnel to schema.ts**

In `src/lib/schema.ts`, inside the `scorecard` object, add:
```ts
    funnel: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
```

- [ ] **Step 3: Populate the funnel in score.ts**

Change `assembleDataset`'s signature to accept optional counts and set the funnel.
Replace the `assembleDataset` parameter list and the `ds` construction:
```ts
export function assembleDataset(
  creator: { handle: string; name: string },
  reelCalls: ReelCall[],
  ohlc: Record<string, OhlcBar[]>,
  generatedAt: string,
  counts?: { reelsScraped: number; reelsWithTicker: number },
): Dataset {
```
After `calls = dedupeFirstCall(calls);`, build the funnel:
```ts
  const firstCalls = calls.filter(c => c.isFirstCall);
  const beatSpy = firstCalls.filter(c => (c.returns.toDate.excess ?? -1) > 0).length;
  const funnel = counts ? [
    { label: "Reels (12mo)", value: counts.reelsScraped },
    { label: "Named a stock", value: counts.reelsWithTicker },
    { label: "Explicit buy call", value: calls.length },
    { label: "Beat SPY (to date)", value: beatSpy },
  ] : undefined;
```
Then add `funnel` to the scorecard when building `ds`:
```ts
    scorecard: { ...buildScorecard(calls), funnel }, caveats: CAVEATS,
```
In `score()`, read the counts and pass them. After loading `reelCalls`, add:
```ts
  const { readFile: rf } = await import("node:fs/promises");
  let reelsScraped = reelCalls.length;
  try { reelsScraped = JSON.parse(await rf(join(creatorDir(handle), "raw", "shortcodes.json"), "utf8")).length; } catch {}
```
And change the `assembleDataset(...)` call to:
```ts
  const ds = assembleDataset({ handle, name }, reelCalls, ohlc, today,
    { reelsScraped, reelsWithTicker: reelCalls.length });
```

- [ ] **Step 4: Re-run score tests to confirm no regression**

Run from `influencer-tracker/`: `bun test pipeline/score.test.ts`
Expected: PASS (funnel is optional; the existing test passes no counts).

- [ ] **Step 5: Implement AnalyticsCharts.tsx**

```tsx
// bklit charts: no barrel — import each from its file (verify exact symbols by reading the files).
import { Gauge } from "#/components/charts/gauge";
import { BarChart, Bar } from "#/components/charts/bar-chart";
import { ScatterChart, Scatter } from "#/components/charts/scatter-chart";
import { FunnelChart } from "#/components/charts/funnel-chart";
import { Grid } from "#/components/charts/grid";
import { XAxis } from "#/components/charts/x-axis";
import { ChartTooltip } from "#/components/charts/tooltip";
import type { Dataset, Horizon } from "../lib/types";
import { Card } from "#/components/ui/card";

const HORIZONS: Horizon[] = ["1w", "1m", "3m", "toDate"];

export function AnalyticsCharts({ ds }: { ds: Dataset }) {
  const sc = ds.scorecard;
  const excessByHorizon = HORIZONS.map(h => ({ horizon: h, excess: +(sc.avgExcess[h] * 100).toFixed(1) }));
  const convVsReturn = ds.calls
    .filter(c => c.returns.toDate.excess != null)
    .map(c => ({ conviction: c.conviction, excess: +(c.returns.toDate.excess! * 100).toFixed(1) }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Hit rate (calls beating SPY, 3m)</div>
        <Gauge value={Math.round(sc.hitRate["3m"] * 100)} centerValue={sc.hitRate["3m"]}
          defaultLabel="beat SPY" inactiveFillOpacity={0.4}
          formatOptions={{ style: "percent", maximumFractionDigits: 0 }} />
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Avg excess return by horizon (%)</div>
        <BarChart data={excessByHorizon} xDataKey="horizon">
          <Grid horizontal highlightRowValues={[0]} />
          <Bar dataKey="excess" />
          <XAxis />
          <ChartTooltip />
        </BarChart>
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Conviction vs return (does confidence predict accuracy?)</div>
        <ScatterChart data={convVsReturn} xDataKey="conviction">
          <Grid horizontal highlightRowValues={[0]} />
          <Scatter dataKey="excess" strokeWidth={0} yGradient />
          <XAxis />
          <ChartTooltip />
        </ScatterChart>
      </Card>
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">Call funnel</div>
        {sc.funnel
          ? <FunnelChart data={sc.funnel} color="var(--chart-1)" layers={3} />
          : <p className="text-sm text-muted-foreground">Run the full pipeline to populate.</p>}
      </Card>
    </div>
  );
}
```

> NOTE: bklit prop names are taken from the component docs; if `tsc` flags a prop
> (e.g. `xDataKey` on `BarChart`/`ScatterChart`), confirm the exact name in the
> component's Studio page and adjust. The data shapes above are correct.

- [ ] **Step 6: Render AnalyticsCharts in the overview route**

In `src/routes/c.$handle.tsx`, import and place it under the timeline section:
```tsx
import { AnalyticsCharts } from "../components/AnalyticsCharts";
// ...inside <main>, after the timeline <section>:
      <section><h2 className="font-semibold mb-2">Analytics</h2>
        <AnalyticsCharts ds={ds} /></section>
```

- [ ] **Step 7: Verify and commit**

Run `bun run dev`, open `localhost:3000/c/kevvonz`.
Expected: gauge, bar, scatter, and funnel charts render below the timeline.
```bash
bunx tsc --noEmit
git add src/lib/types.ts src/lib/schema.ts pipeline/score.ts src/components/AnalyticsCharts.tsx 'src/routes/c.$handle.tsx'
git commit -m "feat: overview analytics charts (gauge, bar, scatter, funnel)"
```

### Task 4.8: README

**Files:**
- Create: `influencer-tracker/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Influencer Signal Tracker

Scores finfluencer stock calls against real forward prices (vs SPY).

## Setup
- `bun install`
- `bunx playwright install chromium`
- `cp .env.example .env` and set `GROQ_API_KEY`

## Run the pipeline for a creator
```
bun run pipeline --handle <handle> --name "<Name>"
# log into Instagram in the launched browser when prompted
# after the extract stage, review data/creators/<handle>/calls.review.md
bun run pipeline --handle <handle> --name "<Name>" --from prices
```

## View the dashboard
```
bun run dev   # http://localhost:3000
```

Adding a creator needs no code change — just run the pipeline with a new handle.

See `../docs/superpowers/specs/2026-06-02-influencer-signal-tracker-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: influencer-tracker README"
```

---

## Self-review notes

- **Spec coverage:** Phase 0 (restructure) ✓; scrape/transcribe/frames/extract/prices/score ✓ (Tasks 3.1–3.6); orchestrator + resume + review pause ✓ (3.7); explicit-bullish-only filter ✓ (extract + assembleDataset); excess-vs-SPY headline ✓ (returns/scorecard); per-creator namespacing + index + multi-creator-without-code-change ✓ (config/score/run); landing + overview + ticker routes ✓ (4.2/4.4/4.5); caveats in-product ✓ (4.3); no-fabricated-data fail-closed ✓ (prices FLAG, schema.parse in score).
- **bklit charts used (7 of 9):** candlestick + line (ticker, Task 4.5), gauge + bar + scatter + funnel (overview analytics, Task 4.7); composed installed and available. **choropleth rejected** (no geographic data — would fake it); **sankey deferred** (needs per-ticker sector tagging).
- **Deferred (per spec):** cross-creator comparison UI — intentionally not a task. Sankey sector-flow chart — needs sector enrichment.
- **Type consistency:** `Horizon`, `Call`, `ReelCall`, `OhlcBar`, `ReturnTriple`, `Dataset`, `Scorecard` defined once in `types.ts`; `computeReturns`, `closeOnOrAfter`, `forwardReturn`, `dedupeFirstCall`, `buildScorecard`, `assembleDataset` signatures consistent across tasks.
- **External-shape risks flagged inline:** Instagram GraphQL node shape (3.1), Groq model ids (3.0 discovery), TanStack `createServerFn` import (4.1) — each has a verification step.
```
