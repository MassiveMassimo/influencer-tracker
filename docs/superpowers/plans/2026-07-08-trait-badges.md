# Trait Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer 0–N independently-earned trait badges (own SVG silhouette + gradient + filled icon + hover blurb) next to the grade medallion, computed client-side from the creator's calls.

**Architecture:** Pure data layer `src/lib/traits.ts` (`traitsFor(calls) → Trait[]`, flat predicate array, per-trait N-guards, priority-ordered) mirroring `gradeFor`'s client-side computation; presentation in `src/components/trait-badges.tsx` (per-shape SVG paths, hue-token gradients, coss `preview-card` popovers, cap-3 + overflow chip); wired into the creator overview route at the two existing `GradeDetail` render sites.

**Tech Stack:** TypeScript, React, Base UI preview-card (existing `ui/preview-card.tsx`), Iconify Tailwind classes (existing plugin), bun test.

**Spec:** `docs/superpowers/specs/2026-07-08-trait-badges-design.md`

## Global Constraints

- All work in a git worktree on branch `trait-badges` (`git worktree add ../influencer-tracker-trait-badges -b trait-badges`) — never on `main`; the primary checkout stays on `main`.
- Tests: `bun test`; typecheck: `bunx tsc --noEmit`. Both must pass in the worktree before merging.
- `#/` import alias maps to `src/`.
- Visual verification happens on `main` after merge, with headful Playwright reusing `.chrome-profile` (NOT claude-in-chrome — see CLAUDE.md browser-automation note).
- Tailwind classes must be full literal strings (no `text-${hue}-600` interpolation — purged).
- Dynamic per-trait icon classes use the Iconify plugin: `icon-[<set>--<name>]`.
- No dataset/pipeline/DB change anywhere in this plan.

---

### Task 1: Statistical helpers

**Files:**
- Create: `src/lib/traits.ts` (helpers only in this task)
- Test: `src/lib/traits.test.ts`

**Interfaces:**
- Produces: `mean(xs: number[]): number`, `stdev(xs: number[]): number` (population), `median(xs: number[]): number`, `skewness(xs: number[]): number` (Fisher-Pearson g1, population moments), `pearson(xs: number[], ys: number[]): number` — all exported from `src/lib/traits.ts`, all returning `0` on degenerate input (empty / n too small / zero variance).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/traits.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mean, median, pearson, skewness, stdev } from "./traits";

describe("stat helpers", () => {
  test("mean", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
  });

  test("stdev is population stdev, 0 on degenerate input", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
    expect(stdev([5])).toBe(0);
    expect(stdev([])).toBe(0);
  });

  test("median handles odd, even, empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  test("median does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  test("skewness: symmetric ~0, right-tailed positive, degenerate 0", () => {
    expect(skewness([-1, 0, 1])).toBeCloseTo(0, 10);
    // 19 small losses + 5 big wins: g1 ≈ 1.44 (population moments)
    const xs = [...Array(19).fill(-0.05), ...Array(5).fill(1)];
    expect(skewness(xs)).toBeGreaterThan(1);
    expect(skewness([1, 1])).toBe(0); // n < 3
    expect(skewness([2, 2, 2])).toBe(0); // zero variance
  });

  test("pearson: perfect +/-1, degenerate 0", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1], [1])).toBe(0); // n < 2
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0); // zero variance
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/traits.test.ts`
Expected: FAIL — cannot resolve `./traits` (module doesn't exist yet).

- [ ] **Step 3: Implement the helpers**

Create `src/lib/traits.ts`:

```ts
// Trait badges: independent boolean signals layered on top of the letter persona
// (see docs/superpowers/specs/2026-07-08-trait-badges-design.md). Each trait is a
// pure predicate over the creator's calls with its own N-guard — below the guard it
// never fires. Thresholds are tuned against the live roster (scripts/print-traits.ts)
// the same way K and the bands are in grade.ts.

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// Population stdev (matches the population moments skewness uses).
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Fisher-Pearson g1 with population moments; 0 when undefined (n < 3, zero variance).
export function skewness(xs: number[]): number {
  if (xs.length < 3) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  return mean(xs.map((x) => ((x - m) / s) ** 3));
}

// Pearson correlation; 0 when undefined (n < 2, zero variance in either series).
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/traits.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/traits.ts src/lib/traits.test.ts
git commit -m "feat(traits): statistical helpers for trait predicates"
```

---

### Task 2: Trait predicates + `traitsFor`

**Files:**
- Modify: `src/lib/traits.ts` (append below the helpers)
- Test: `src/lib/traits.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 helpers; `Call` from `#/lib/types` (`isFirstCall`, `conviction`, `ticker`, `postDate`, `returns[h] = { stock, spy, excess }`).
- Produces:
  - `interface Trait { id: string; name: string; blurb: string; hue: "orange" | "red" | "violet" | "amber" | "emerald" | "rose" | "teal" | "fuchsia"; shape: "hexagon" | "triangle-down" | "ticket" | "shield" | "star" | "rosette"; icon: string }`
  - `traitsFor(calls: Call[]): Trait[]` — earned traits, already sorted by display priority. (Spec originally sketched `traitsFor(sc, calls)`; no v1 trait reads the Scorecard, so the signature drops it.)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/traits.test.ts`:

```ts
import type { Call } from "./types";
import { traitsFor } from "./traits";

// Minimal Call factory. ex3 sets returns["3m"] = { stock: ex3+spy3, spy: spy3, excess: ex3 }.
let seq = 0;
function mk(over: {
  ticker: string;
  postDate: string;
  ex3?: number | null;
  spy3?: number | null;
  exToDate?: number | null;
  isFirstCall?: boolean;
  conviction?: number;
}): Call {
  const { ticker, postDate, ex3 = null, spy3 = 0.01, exToDate = null } = over;
  const nul = { stock: null, spy: null, excess: null };
  return {
    shortcode: `s${seq++}`,
    postDate,
    ticker,
    company: "",
    isFirstCall: over.isFirstCall ?? true,
    conviction: over.conviction ?? 0.5,
    quote: "",
    returns: {
      "1w": { ...nul },
      "1m": { ...nul },
      "3m": ex3 == null ? { ...nul } : { stock: ex3 + (spy3 ?? 0), spy: spy3, excess: ex3 },
      toDate: exToDate == null ? { ...nul } : { stock: exToDate, spy: 0, excess: exToDate },
    },
  };
}

// n first-calls on distinct tickers, one day apart, ex3 from fn.
function roster(n: number, ex3: (i: number) => number, opts?: { conviction?: (i: number) => number }): Call[] {
  return Array.from({ length: n }, (_, i) =>
    mk({
      ticker: `T${i}`,
      postDate: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
      ex3: ex3(i),
      conviction: opts?.conviction?.(i),
    }),
  );
}

const ids = (calls: Call[]) => traitsFor(calls).map((t) => t.id);

describe("traitsFor", () => {
  test("empty and tiny inputs earn nothing", () => {
    expect(traitsFor([])).toEqual([]);
    expect(ids(roster(5, () => 0.1))).toEqual([]);
  });

  test("laser-eyes: >60% crypto first-calls, n>=10", () => {
    const cryptos = ["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "ADA-USD", "XRP-USD", "AVAX-USD"];
    const calls = [
      ...cryptos.map((t, i) => mk({ ticker: t, postDate: `2025-01-0${i + 1}`, ex3: 0.01 })),
      mk({ ticker: "AAPL", postDate: "2025-02-01", ex3: 0.01 }),
      mk({ ticker: "NVDA", postDate: "2025-02-02", ex3: 0.01 }),
      mk({ ticker: "TSLA", postDate: "2025-02-03", ex3: 0.01 }),
    ];
    expect(ids(calls)).toContain("laser-eyes");
    // 9 calls (below guard) → not earned
    expect(ids(calls.slice(0, 9))).not.toContain("laser-eyes");
  });

  test("martingale: >=3 re-pitches of an underwater ticker", () => {
    const calls = [
      mk({ ticker: "GME", postDate: "2025-01-01", ex3: -0.1 }),
      mk({ ticker: "GME", postDate: "2025-02-01", ex3: -0.2, isFirstCall: false }),
      mk({ ticker: "GME", postDate: "2025-03-01", ex3: -0.3, isFirstCall: false }),
      mk({ ticker: "GME", postDate: "2025-04-01", ex3: 0.05, isFirstCall: false }),
    ];
    expect(ids(calls)).toContain("martingale");
    // Only 2 events → not earned
    expect(ids(calls.slice(0, 3))).not.toContain("martingale");
  });

  test("martingale falls back to toDate excess when prior 3m is null", () => {
    const calls = [
      mk({ ticker: "GME", postDate: "2025-01-01", exToDate: -0.1 }),
      mk({ ticker: "GME", postDate: "2025-02-01", exToDate: -0.2, isFirstCall: false }),
      mk({ ticker: "GME", postDate: "2025-03-01", exToDate: -0.3, isFirstCall: false }),
      mk({ ticker: "GME", postDate: "2025-04-01", isFirstCall: false }),
    ];
    expect(ids(calls)).toContain("martingale");
  });

  test("lottery-ticket: positive skew with negative median, n>=20", () => {
    // 19 small losers + 5 moonshots: skew ≈ 1.44 > 1, median -0.05 < 0
    const calls = roster(24, (i) => (i < 19 ? -0.05 : 1));
    expect(ids(calls)).toContain("lottery-ticket");
    // Symmetric outcomes → not earned
    expect(ids(roster(24, (i) => (i % 2 ? 0.1 : -0.1)))).not.toContain("lottery-ticket");
  });

  test("bull-only: wins only when SPY is up, >=8 calls per regime", () => {
    const up = Array.from({ length: 8 }, (_, i) =>
      mk({ ticker: `U${i}`, postDate: `2025-01-0${i + 1}`, ex3: 0.05, spy3: 0.02 }),
    );
    const down = Array.from({ length: 8 }, (_, i) =>
      mk({ ticker: `D${i}`, postDate: `2025-02-0${i + 1}`, ex3: -0.05, spy3: -0.02 }),
    );
    expect(ids([...up, ...down])).toContain("bull-only");
    // 7 down-regime calls (below guard) → not earned
    expect(ids([...up, ...down.slice(0, 7)])).not.toContain("bull-only");
  });

  test("rising-star / fallen-star: half-career delta, n>=30, mutually exclusive", () => {
    const rising = roster(30, (i) => (i < 15 ? -0.05 : 0.05));
    expect(ids(rising)).toContain("rising-star");
    expect(ids(rising)).not.toContain("fallen-star");
    const falling = roster(30, (i) => (i < 15 ? 0.05 : -0.05));
    expect(ids(falling)).toContain("fallen-star");
    expect(ids(falling)).not.toContain("rising-star");
    // Flat career → neither
    expect(ids(roster(30, () => 0.01))).not.toContain("rising-star");
  });

  test("calibrated / confidently-wrong: conviction-excess correlation, n>=30", () => {
    const calib = roster(30, (i) => i / 30 - 0.5, { conviction: (i) => i / 30 });
    expect(ids(calib)).toContain("calibrated");
    const wrong = roster(30, (i) => 0.5 - i / 30, { conviction: (i) => i / 30 });
    expect(ids(wrong)).toContain("confidently-wrong");
    // Flat conviction (stdev guard) → neither
    const flat = roster(30, (i) => i / 30 - 0.5, { conviction: () => 0.9 });
    expect(ids(flat)).not.toContain("calibrated");
  });

  test("results are priority-ordered and input is not mutated", () => {
    // Earns calibrated (corr), rising-star (halves), martingale (re-pitches) at once.
    const base = roster(30, (i) => (i < 15 ? -0.2 + i * 0.01 : 0.05 + i * 0.01), {
      conviction: (i) => i / 30,
    });
    const gme = [
      mk({ ticker: "GME", postDate: "2024-12-01", ex3: -0.1 }),
      mk({ ticker: "GME", postDate: "2024-12-10", ex3: -0.2, isFirstCall: false }),
      mk({ ticker: "GME", postDate: "2024-12-20", ex3: -0.3, isFirstCall: false }),
      mk({ ticker: "GME", postDate: "2024-12-28", ex3: -0.3, isFirstCall: false }),
    ];
    const calls = [...base, ...gme];
    const snapshot = [...calls];
    const got = ids(calls);
    expect(calls).toEqual(snapshot); // no mutation
    const priority = ["calibrated", "rising-star", "martingale"];
    expect(got.filter((id) => priority.includes(id))).toEqual(
      priority.filter((id) => got.includes(id)),
    );
    expect(got).toContain("martingale");
  });
});
```

NOTE for the ordering test: the exact set earned depends on interacting fixtures (the GME losers shift the correlation slightly). The assertions only require relative order of whichever fire plus martingale — do NOT strengthen them to exact-set equality.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/traits.test.ts`
Expected: FAIL — `traitsFor` not exported.

- [ ] **Step 3: Implement predicates + `traitsFor`**

Append to `src/lib/traits.ts`:

```ts
import type { Call } from "./types";

// Thresholds (tuned with the roster; see spec).
const CRYPTO_SHARE = 0.6;
const CRYPTO_MIN_N = 10;
const MARTINGALE_EVENTS = 3;
const LOTTERY_MIN_N = 20;
const LOTTERY_SKEW = 1;
const REGIME_MIN_N = 8; // scored calls required in EACH SPY regime
const REGIME_GAP = 0.3; // hit(SPY-up) - hit(SPY-down)
const TRAJECTORY_MIN_N = 30;
const TRAJECTORY_DELTA = 0.08; // mean 3m excess, second half minus first
const CALIBRATION_MIN_N = 30;
const CALIBRATION_R = 0.3;
const CONVICTION_MIN_SD = 0.05; // conviction must actually vary

export interface Trait {
  id: string;
  name: string;
  blurb: string; // one playful line, PERSONA_BLURB voice
  hue: "orange" | "red" | "violet" | "amber" | "emerald" | "rose" | "teal" | "fuchsia";
  shape: "hexagon" | "triangle-down" | "ticket" | "shield" | "star" | "rosette";
  icon: string; // iconify tailwind class, e.g. "icon-[mdi--fire]"
}

interface TraitCtx {
  first: Call[]; // isFirstCall, postDate ascending
  ex3: number[]; // non-null 3m excess of first calls, postDate order
  byDate: Call[]; // all calls, postDate ascending
}

interface TraitDef extends Trait {
  test(ctx: TraitCtx): boolean;
}

const ex3OrToDate = (c: Call) => c.returns["3m"].excess ?? c.returns.toDate.excess;

// Pearson r of (conviction, 3m excess); 0 = "no signal" (guards included).
function calibrationR(first: Call[]): number {
  const scored = first.filter((c) => c.returns["3m"].excess != null);
  if (scored.length < CALIBRATION_MIN_N) return 0;
  const conv = scored.map((c) => c.conviction);
  if (stdev(conv) <= CONVICTION_MIN_SD) return 0;
  return pearson(conv, scored.map((c) => c.returns["3m"].excess as number));
}

// hit(SPY-up) - hit(SPY-down) with the down-regime hit rate, or null below guard.
function regimeSplit(first: Call[]): { gap: number; downHit: number } | null {
  const up: boolean[] = [];
  const down: boolean[] = [];
  for (const c of first) {
    const ex = c.returns["3m"].excess;
    const spy = c.returns["3m"].spy;
    if (ex == null || spy == null || spy === 0) continue;
    (spy > 0 ? up : down).push(ex > 0);
  }
  if (up.length < REGIME_MIN_N || down.length < REGIME_MIN_N) return null;
  const hit = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;
  return { gap: hit(up) - hit(down), downHit: hit(down) };
}

// Mean 3m excess of the second half of the record minus the first; 0 below guard.
function trajectoryDelta(ex3: number[]): number {
  if (ex3.length < TRAJECTORY_MIN_N) return 0;
  const half = Math.floor(ex3.length / 2);
  return mean(ex3.slice(half)) - mean(ex3.slice(0, half));
}

// A re-pitch (non-first call) of a ticker whose most recent prior call is underwater.
function martingaleEvents(byDate: Call[]): number {
  let events = 0;
  const lastByTicker = new Map<string, Call>();
  for (const c of byDate) {
    const prior = lastByTicker.get(c.ticker);
    if (!c.isFirstCall && prior) {
      const ex = ex3OrToDate(prior);
      if (ex != null && ex < 0) events++;
    }
    lastByTicker.set(c.ticker, c);
  }
  return events;
}

// Array order IS the display priority (most informative first).
const TRAITS: TraitDef[] = [
  {
    id: "calibrated",
    name: "Calibrated",
    blurb: "When they say high conviction, believe it — confidence tracks results.",
    hue: "teal",
    shape: "rosette",
    icon: "icon-[mdi--bullseye-arrow]",
    test: ({ first }) => calibrationR(first) >= CALIBRATION_R,
  },
  {
    id: "confidently-wrong",
    name: "Confidently Wrong",
    blurb: "The louder the conviction, the worse the call. Fade the pounding table.",
    hue: "fuchsia",
    shape: "rosette",
    icon: "icon-[mdi--compass-off]",
    test: ({ first }) => calibrationR(first) <= -CALIBRATION_R,
  },
  {
    id: "bull-only",
    name: "Bull Market Only",
    blurb: "Great when SPY's green. When it's red, so are the calls.",
    hue: "amber",
    shape: "shield",
    icon: "icon-[game-icons--bull-horns]",
    test: ({ first }) => {
      const r = regimeSplit(first);
      return r != null && r.gap >= REGIME_GAP && r.downHit < 0.5;
    },
  },
  {
    id: "rising-star",
    name: "Rising Star",
    blurb: "The recent record is way better than the early one. Improving.",
    hue: "emerald",
    shape: "star",
    icon: "icon-[mdi--arrow-up-bold]",
    test: ({ ex3 }) => trajectoryDelta(ex3) >= TRAJECTORY_DELTA,
  },
  {
    id: "fallen-star",
    name: "Fallen Star",
    blurb: "Used to be sharp. The recent calls don't keep up.",
    hue: "rose",
    shape: "star",
    icon: "icon-[mdi--arrow-down-bold]",
    test: ({ ex3 }) => trajectoryDelta(ex3) <= -TRAJECTORY_DELTA,
  },
  {
    id: "martingale",
    name: "The Martingale",
    blurb: "Keeps doubling down on losers. It has to bounce eventually, right?",
    hue: "red",
    shape: "triangle-down",
    icon: "icon-[mdi--trending-down]",
    test: ({ byDate }) => martingaleEvents(byDate) >= MARTINGALE_EVENTS,
  },
  {
    id: "lottery-ticket",
    name: "Lottery Ticket",
    blurb: "Most calls fizzle; the occasional moonshot pays for the rest.",
    hue: "violet",
    shape: "ticket",
    icon: "icon-[mdi--dice-multiple]",
    test: ({ ex3 }) =>
      ex3.length >= LOTTERY_MIN_N && skewness(ex3) > LOTTERY_SKEW && median(ex3) < 0,
  },
  {
    id: "laser-eyes",
    name: "Laser Eyes",
    blurb: "Portfolio's mostly crypto. Number-go-up technology.",
    hue: "orange",
    shape: "hexagon",
    icon: "icon-[mdi--fire]",
    test: ({ first }) =>
      first.length >= CRYPTO_MIN_N &&
      first.filter((c) => c.ticker.endsWith("-USD")).length / first.length > CRYPTO_SHARE,
  },
];

// Earned traits, in display-priority order. Pure; never mutates `calls`.
export function traitsFor(calls: Call[]): Trait[] {
  const byDate = [...calls].sort((a, b) => a.postDate.localeCompare(b.postDate));
  const first = byDate.filter((c) => c.isFirstCall);
  const ex3 = first
    .map((c) => c.returns["3m"].excess)
    .filter((x): x is number => x != null);
  const ctx: TraitCtx = { first, ex3, byDate };
  return TRAITS.filter((t) => t.test(ctx)).map(({ test: _test, ...meta }) => meta);
}
```

Move the `import type { Call } from "./types";` line to the TOP of the file (imports must precede the Task 1 helpers).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/traits.test.ts`
Expected: PASS (all Task 1 + Task 2 tests). If the ordering test fails on which traits fire (fixture interaction), adjust the FIXTURE, never the priority order.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/traits.ts src/lib/traits.test.ts
git commit -m "feat(traits): trait predicates + traitsFor with per-trait N-guards"
```

---

### Task 3: `TraitBadges` component

**Files:**
- Create: `src/components/trait-badges.tsx`

**Interfaces:**
- Consumes: `traitsFor(calls)`, `Trait` from `#/lib/traits`; `PreviewCard`, `PreviewCardTrigger`, `PreviewCardPopup` from `#/components/ui/preview-card.tsx` (same API `GradeDetail` uses — see `src/components/grade-detail.tsx:149-173`).
- Produces: `TraitBadges({ calls, className }: { calls: Call[]; className?: string })` — renders `null` when no traits earned; otherwise a badge row (max 3 + "+N" overflow chip).

- [ ] **Step 1: Write the component**

Create `src/components/trait-badges.tsx`:

```tsx
// Trait badges: 0-N independently-earned behavioral signals next to the grade
// medallion. Each trait has its own SVG silhouette, a subtle same-hue gradient
// fill, and a filled icon; hover/tap opens a preview card with the blurb.
// Data layer: src/lib/traits.ts. Spec: docs/superpowers/specs/2026-07-08-*.md.
import { useMemo } from "react";
import type { Call } from "#/lib/types";
import { traitsFor, type Trait } from "#/lib/traits";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";

const VISIBLE = 3;

// 12-scallop award-seal silhouette, generated once (deterministic).
const ROSETTE = (() => {
  const n = 12;
  const r = 9.6;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return [12 + r * Math.cos(a), 12 + r * Math.sin(a)] as const;
  });
  const chord = 2 * r * Math.sin(Math.PI / n);
  const bump = ((chord / 2) * 1.25).toFixed(2);
  return (
    `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}` +
    pts
      .map((_, i) => {
        const [x, y] = pts[(i + 1) % n];
        return `A${bump} ${bump} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join("") +
    "Z"
  );
})();

// 24x24 silhouettes. `ticket` is the user-supplied side-notched stub (spec).
const SHAPES: Record<Trait["shape"], string> = {
  hexagon: "M12 2l8.66 5v10L12 22l-8.66-5V7L12 2z",
  "triangle-down": "M3 4h18a1 1 0 0 1 .86 1.5l-9 15.6a1 1 0 0 1-1.73 0l-9-15.6A1 1 0 0 1 3 4z",
  ticket:
    "M19 4C19.7956 4 20.5585 4.3163 21.1211 4.87891C21.6837 5.44152 22 6.20435 22 7V10C22 10.2449 21.9098 10.481 21.7471 10.6641C21.5843 10.8471 21.3604 10.9645 21.1172 10.9932L21 11C20.7452 11.0003 20.4998 11.0976 20.3145 11.2725C20.1291 11.4474 20.0179 11.687 20.0029 11.9414C19.988 12.1958 20.0708 12.4462 20.2344 12.6416C20.3979 12.837 20.6298 12.963 20.8828 12.9932L21 13C21.2652 13 21.5195 13.1054 21.707 13.293C21.8946 13.4805 22 13.7348 22 14V17C22 17.7956 21.6837 18.5585 21.1211 19.1211C20.5585 19.6837 19.7956 20 19 20H5C4.20435 20 3.44152 19.6837 2.87891 19.1211C2.3163 18.5585 2 17.7956 2 17V14C2.00003 13.7551 2.09021 13.519 2.25293 13.3359C2.41565 13.1529 2.63963 13.0355 2.88281 13.0068L3 13C3.25483 12.9997 3.50022 12.9024 3.68555 12.7275C3.87088 12.5526 3.98213 12.313 3.99707 12.0586C4.012 11.8042 3.92917 11.5538 3.76563 11.3584C3.60207 11.163 3.37022 11.037 3.11719 11.0068L3 11C2.73478 11 2.48051 10.8946 2.29297 10.707C2.10543 10.5195 2 10.2652 2 10V7C1.9995 6.25172 2.27948 5.52999 2.78418 4.97754C3.28876 4.42542 3.98162 4.08168 4.72656 4.01465L4.94922 4.00098L19 4Z",
  shield: "M12 2l8 3.2V11c0 4.9-3.4 8.5-8 10.8C7.4 19.5 4 15.9 4 11V5.2L12 2z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.62L12 2 9.19 8.62 2 9.24l5.45 4.73L5.82 21 12 17.27z",
  rosette: ROSETTE,
};

// Full literal class strings (Tailwind purges interpolated names). `v` is the
// Tailwind v4 color custom property driving the SVG gradient stops.
const HUES: Record<Trait["hue"], { icon: string; v: string }> = {
  orange: { icon: "text-orange-600 dark:text-orange-400", v: "--color-orange-500" },
  red: { icon: "text-red-600 dark:text-red-400", v: "--color-red-500" },
  violet: { icon: "text-violet-600 dark:text-violet-400", v: "--color-violet-500" },
  amber: { icon: "text-amber-600 dark:text-amber-400", v: "--color-amber-500" },
  emerald: { icon: "text-emerald-600 dark:text-emerald-400", v: "--color-emerald-500" },
  rose: { icon: "text-rose-600 dark:text-rose-400", v: "--color-rose-500" },
  teal: { icon: "text-teal-600 dark:text-teal-400", v: "--color-teal-500" },
  fuchsia: { icon: "text-fuchsia-600 dark:text-fuchsia-400", v: "--color-fuchsia-500" },
};

function BadgeShape({ trait }: { trait: Trait }) {
  const hue = HUES[trait.hue];
  // Gradient ids collide across the desktop-header and mobile-cell instances
  // (both mounted, CSS-hidden) — harmless: same hue resolves either way.
  const gid = `tb-${trait.id}`;
  return (
    <span className="relative grid size-8 place-items-center">
      <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`var(${hue.v})`} stopOpacity="0.28" />
            <stop offset="1" stopColor={`var(${hue.v})`} stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <path
          d={SHAPES[trait.shape]}
          fill={`url(#${gid})`}
          stroke={`var(${hue.v})`}
          strokeOpacity="0.3"
          strokeWidth="1"
        />
      </svg>
      <span
        className={`${trait.icon} relative text-[13px] ${hue.icon} ${trait.shape === "triangle-down" ? "-translate-y-0.5" : ""}`}
      />
    </span>
  );
}

function TraitBlurb({ trait }: { trait: Trait }) {
  return (
    <div className="flex items-start gap-2.5">
      <BadgeShape trait={trait} />
      <div className="min-w-0">
        <div className="font-heading text-sm text-foreground">{trait.name}</div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          {trait.blurb}
        </p>
      </div>
    </div>
  );
}

function Badge({ trait }: { trait: Trait }) {
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={0}
        render={
          <button
            type="button"
            aria-label={`Trait: ${trait.name}`}
            className="cursor-default rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <BadgeShape trait={trait} />
      </PreviewCardTrigger>
      <PreviewCardPopup className="w-64 flex-col">
        <TraitBlurb trait={trait} />
      </PreviewCardPopup>
    </PreviewCard>
  );
}

export function TraitBadges({ calls, className }: { calls: Call[]; className?: string }) {
  const traits = useMemo(() => traitsFor(calls), [calls]);
  if (!traits.length) return null;
  const shown = traits.slice(0, VISIBLE);
  const rest = traits.slice(VISIBLE);
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      {shown.map((t) => (
        <Badge key={t.id} trait={t} />
      ))}
      {rest.length > 0 && (
        <PreviewCard>
          <PreviewCardTrigger
            delay={0}
            render={
              <button
                type="button"
                aria-label={`${rest.length} more traits`}
                className="cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            <span className="grid size-8 place-items-center rounded-full border border-border/60 bg-muted/40 font-mono text-[10px] text-muted-foreground">
              +{rest.length}
            </span>
          </PreviewCardTrigger>
          <PreviewCardPopup className="w-64 flex-col gap-3">
            {rest.map((t) => (
              <TraitBlurb key={t.id} trait={t} />
            ))}
          </PreviewCardPopup>
        </PreviewCard>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean. (No unit test — pure presentation; this repo tests UI visually. The component is exercised on-page in Task 5/6.)

- [ ] **Step 3: Commit**

```bash
git add src/components/trait-badges.tsx
git commit -m "feat(traits): TraitBadges component — per-shape SVG badges + preview-card blurbs"
```

---

### Task 4: Wire into the creator overview

**Files:**
- Modify: `src/routes/c.$handle.index.tsx` (two `GradeDetail` sites, ~lines 288-301 and ~348-355)

**Interfaces:**
- Consumes: `TraitBadges` from Task 3; existing `grade` memo and `ds` in the route.

- [ ] **Step 1: Add the import**

In `src/routes/c.$handle.index.tsx`, next to the existing grade imports (lines 11-12):

```tsx
import { TraitBadges } from "#/components/trait-badges";
```

- [ ] **Step 2: Desktop — badges left of the medallion in the sticky header**

Find (around line 288):

```tsx
            <div className="t-stick-fade absolute inset-y-0 right-0 flex items-center justify-end text-right max-md:hidden">
              {grade ? (
                <GradeDetail grade={grade} />
              ) : (
```

Replace the `grade ? (...)` branch with:

```tsx
              {grade ? (
                <div className="flex items-center gap-3">
                  <TraitBadges calls={ds.calls} />
                  <GradeDetail grade={grade} />
                </div>
              ) : (
```

(The container is `justify-end`, so the badge row sits immediately left of the medallion.)

- [ ] **Step 3: Mobile — badges wrap below the medallion in the 6th grid cell**

Find (around line 350):

```tsx
          {grade && (
            <div className="grid place-items-center bg-background p-4 md:hidden">
              <GradeDetail grade={grade} fontSize="0.4rem" letterClassName="text-xl" />
            </div>
          )}
```

Replace with:

```tsx
          {grade && (
            <div className="grid place-items-center gap-2 bg-background p-4 md:hidden">
              <GradeDetail grade={grade} fontSize="0.4rem" letterClassName="text-xl" />
              <TraitBadges calls={ds.calls} />
            </div>
          )}
```

Badges render only when the medallion renders (both sites gated on `grade`), per spec.

- [ ] **Step 4: Verify**

Run: `bun test && bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/c.\$handle.index.tsx
git commit -m "feat(traits): render trait badges beside grade medallion on creator overview"
```

---

### Task 5: Roster distribution check (threshold sanity)

**Files:**
- Create: `scripts/print-traits.ts`

**Interfaces:**
- Consumes: `traitsFor` from `#/lib/traits` (script imports via relative path); committed `data/creators/*/dataset.json`.

- [ ] **Step 1: Write the script**

Create `scripts/print-traits.ts`:

```ts
// Prints earned trait ids per committed creator dataset. Threshold-tuning aid for
// src/lib/traits.ts — run after changing any trait constant.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "../src/lib/types";
import { traitsFor } from "../src/lib/traits";

const root = join(import.meta.dir, "..", "data", "creators");
for (const h of readdirSync(root)) {
  const p = join(root, h, "dataset.json");
  if (!existsSync(p)) continue;
  const ds = JSON.parse(readFileSync(p, "utf8")) as Dataset;
  const ids = traitsFor(ds.calls).map((t) => t.id);
  console.log(`${h.padEnd(22)} ${ids.join(", ") || "—"}`);
}
```

- [ ] **Step 2: Run it against the real roster**

Run: `bun run scripts/print-traits.ts`
Expected: one line per creator. Sanity rules — a trait firing for **more than half the roster** is too loose (tighten its constant); every trait firing for **zero** creators is acceptable for rare traits (calibrated, bull-only) but suspicious if ALL eight variants are silent (recheck predicates against a dataset by hand). Record the table in the task report; do NOT silently retune — any constant change goes back through `bun test` and is reported.

- [ ] **Step 3: Commit**

```bash
git add scripts/print-traits.ts
git commit -m "chore(traits): roster trait-distribution script for threshold tuning"
```

---

### Task 6: Merge + visual verification on main

Per the project's worktree workflow (CLAUDE.md): build/test verification in the worktree is done (Tasks 1-5); **visual verification happens on `main` after merge**.

- [ ] **Step 1: Final gate in the worktree**

Run: `bun test && bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Merge to main and remove the worktree**

```bash
cd /Users/imo/Documents/GitHub/influencer-tracker
git merge trait-badges
git worktree remove ../influencer-tracker-trait-badges
git branch -d trait-badges
```

Do NOT push or open a PR unless explicitly asked.

- [ ] **Step 3: Visual pass (headful Playwright, NOT claude-in-chrome)**

Start the dev server on `main`, then drive a headful Playwright session reusing the persistent `.chrome-profile` (same profile `pipeline/scrape.ts` uses); screenshot `/c/<handle>` for a creator with traits (pick from the Task 5 table) at desktop (1280px) and mobile (390px) widths to a file. Check:

- badge row sits LEFT of the medallion in the desktop sticky header; wraps BELOW it in the mobile 6th tile
- each silhouette reads at size-8 (ticket notches visible; rosette scallops not mushy; icon not overflowing the triangle)
- gradient subtle in light AND dark theme; icon darker-same-hue
- hover a badge → preview card with name + blurb; overflow "+N" popover lists the rest
- icons render (a missing Iconify slug renders an empty box — if `game-icons--bull-horns` or any slug is empty, pick a replacement from the same visual pass, full literal class)

Remember the CLAUDE.md automation caveat: `StatTile` zeros in automated screenshots are an IntersectionObserver artifact, not a data bug. Badges are NOT IO-gated and must render.

- [ ] **Step 4: Report**

Show the user the screenshots + the Task 5 trait table. Iterate on `main` if the visual pass finds issues.

---

## Self-review notes

- Spec coverage: data layer (T1-T2), shapes/gradient/icons/popover (T3), placement desktop-left + mobile-below + cap/overflow (T3-T4), gating on medallion (T4), roster tuning (T5), visual pass (T6). Spec's `traitsFor(sc, calls)` signature simplified to `traitsFor(calls)` — no v1 trait reads the Scorecard; spec updated to match.
- Stability/hysteresis: deliberately not implemented (spec: accepted for v1).
- Explore/ticker-page badges, v2 pipeline traits: out of scope per spec.
