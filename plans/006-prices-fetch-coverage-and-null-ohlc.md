# Plan 006: Harden `pipeline/prices.ts` — reject null OHLC bars and refetch under-covered caches

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- pipeline/prices.ts`
> If it changed, compare the "Current state" excerpts against the live code; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (CI gate)
- **Category**: bug
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

Two defects in the pricing fetch, both feeding bad data downstream:

1. **Null high/low slip through.** `fetchOhlc` filters quotes on `open != null &&
close != null`, then non-null-asserts `q.high!` / `q.low!`. A Yahoo quote with
   a null high or low writes `{ h: null, l: null }` into the price file. On read,
   `PriceFileSchema` (`src/lib/schema.ts:13`, every field `z.number()`) **throws**,
   so the ticker-page fallback for that symbol 500s. The live-chart path
   (`src/lib/chart-fetch.ts:34`, `toLiveBars`) already filters all four fields —
   the scoring fetch should match it.

2. **Cache "hit" ignores date coverage.** A cached `<ticker>.json` is accepted
   whenever it has `> 1` bar, with no check that its earliest bar actually covers
   `from` (the minimum `postDate`). When a newly-discovered older call lowers
   `from` (e.g. an X re-scrape reaching deeper history), the old, shorter file is
   kept and the deeper history is never fetched — directly feeding the fabricated
   `0%` returns that Plan 003 guards against.

## Current state

`pipeline/prices.ts` (full file, 44 lines):

```ts
import YahooFinance from "yahoo-finance2";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir } from "./config";
import type { OhlcBar, ReelCall } from "../src/lib/types";

const yahooFinance = new YahooFinance();

async function fetchOhlc(symbol: string, from: string): Promise<OhlcBar[]> {
  const rows = await yahooFinance.chart(symbol, { period1: from, interval: "1d" });
  return rows.quotes
    .filter((q) => q.open != null && q.close != null)
    .map((q) => ({
      date: new Date(q.date).toISOString().slice(0, 10),
      o: q.open!,
      h: q.high!,
      l: q.low!,
      c: q.close!,
    }));
}

export async function prices(handle: string) {
  await mkdir(pricesDir(handle), { recursive: true });
  const calls: ReelCall[] = JSON.parse(
    await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"),
  );
  const tickers = [...new Set(calls.map((c) => c.ticker)), "SPY"];
  const from = calls.reduce(
    (m, c) => (c.postDate < m ? c.postDate : m),
    calls[0]?.postDate ?? "2025-01-01",
  );
  for (const t of tickers) {
    const out = join(pricesDir(handle), `${t}.json`);
    if (existsSync(out)) {
      // Distrust truncated caches: a partial Yahoo run can leave a 1-bar file
      // that the old existsSync skip would keep forever (SPY benchmark broke
      // this way). Only treat >1 bar as a real cache hit.
      try {
        const cached = JSON.parse(await readFile(out, "utf8"));
        if (Array.isArray(cached) && cached.length > 1) continue;
        console.warn(`REFETCH ${t}: cached file has ${cached?.length ?? 0} bar(s)`);
      } catch {
        console.warn(`REFETCH ${t}: unreadable cache`);
      }
    }
    try {
      const ohlc = await fetchOhlc(t, from);
      if (!ohlc.length) {
        console.warn(`FLAG ${t}: no price data`);
        continue;
      }
      await writeFile(out, JSON.stringify(ohlc));
      console.log(`prices ${t}: ${ohlc.length} bars`);
    } catch (e) {
      console.warn(`FLAG ${t}: ${(e as Error).message}`);
    }
  }
}
```

- `OhlcBar` (`src/lib/types.ts:4`): `{ date: string; o,h,l,c: number }` (all
  non-null).
- The reference implementation to mirror — `toLiveBars` in
  `src/lib/chart-fetch.ts:32-42`:
  ```ts
  .filter((q) => q.open != null && q.close != null && q.high != null && q.low != null)
  ```
- There is **no** `prices.test.ts` today. `prices()` itself hits the network
  (Yahoo), so it is not directly unit-testable; the fix is small and
  verification-by-reading-plus-typecheck is acceptable, but extract the testable
  pure parts (see Test plan).
- `from` is the minimum `postDate` over all calls (the intended earliest coverage
  date). Bars are sorted ascending; `cached[0].date` is the earliest cached bar.

## Commands you will need

| Purpose   | Command                            | Expected on success |
| --------- | ---------------------------------- | ------------------- |
| Typecheck | `bunx tsc --noEmit`                | exit 0              |
| Unit test | `bun test pipeline/prices.test.ts` | all pass            |
| Full      | `bun test`                         | all pass            |

## Scope

**In scope**:

- `pipeline/prices.ts`
- `pipeline/prices.test.ts` (create)

**Out of scope** (do NOT touch):

- `src/lib/prices-merge.ts` — the insert-only merge is correct (do not change the
  freeze semantics).
- `src/lib/chart-fetch.ts` — already correct; it's the reference, not a target.
- `src/lib/schema.ts` — `PriceFileSchema` is correct; the fix is to stop writing
  bad bars, not to loosen the schema.
- Committed `data/prices/*.json` and `data/creators/*/prices/` — do not
  regenerate or hand-edit (frozen scoring data).

## Git workflow

- Branch: `advisor/006-prices-fetch-hardening`
- Commit message: conventional commits (e.g.
  `fix(prices): filter null OHLC and refetch under-covered caches`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Filter all four OHLC fields in `fetchOhlc`

Replace the `.filter` in `fetchOhlc` to match `toLiveBars`:

```ts
return rows.quotes
  .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null)
  .map((q) => ({
    date: new Date(q.date).toISOString().slice(0, 10),
    o: q.open!,
    h: q.high!,
    l: q.low!,
    c: q.close!,
  }));
```

(The `!` assertions are now justified by the filter — same pattern as
`chart-fetch.ts`.)

**Verify**: `bunx tsc --noEmit` → exit 0.

### Step 2: Add a coverage check to the cache-hit decision

Extract a small pure predicate and use it. A cached file is a genuine hit only if
it has `> 1` bar **and** its earliest bar is at or before `from` (a few
non-trading days of slack are fine — if the earliest cached bar is later than
`from`, the cache misses older history and must refetch):

```ts
// Exported for tests. A cached series covers the needed range if it has more than
// one bar and its earliest bar is at/before the requested `from` date.
export function cacheCovers(cached: unknown, from: string): boolean {
  if (!Array.isArray(cached) || cached.length <= 1) return false;
  const first = cached[0];
  return typeof first?.date === "string" && first.date <= from;
}
```

Use it in `prices()`:

```ts
if (existsSync(out)) {
  try {
    const cached = JSON.parse(await readFile(out, "utf8"));
    if (cacheCovers(cached, from)) continue;
    console.warn(
      `REFETCH ${t}: cache misses coverage (need <= ${from}, have ${Array.isArray(cached) && cached[0]?.date ? cached[0].date : "?"} / ${Array.isArray(cached) ? cached.length : 0} bar(s))`,
    );
  } catch {
    console.warn(`REFETCH ${t}: unreadable cache`);
  }
}
```

A refetch re-fetches from `from` and overwrites the file. Because the shared
store merge (`src/lib/prices-merge.ts`, applied later in `score.ts`) is
insert-only, refetching can only _add_ older bars — it never rewrites a frozen
bar. (Note: this per-creator file is the fetch cache, overwritten on refetch;
the frozen, insert-only store is `data/prices/`, written by `score.ts` — not
touched here.)

**Verify**: `bunx tsc --noEmit` → exit 0.

## Test plan

Create `pipeline/prices.test.ts` (`import { describe, it, expect } from "bun:test"`).
Test the pure `cacheCovers`:

```ts
import { describe, it, expect } from "bun:test";
import { cacheCovers } from "./prices";

describe("cacheCovers", () => {
  const bars = [
    { date: "2025-01-01", o: 1, h: 1, l: 1, c: 1 },
    { date: "2025-02-01", o: 1, h: 1, l: 1, c: 1 },
  ];
  it("true when earliest bar is at/before `from`", () => {
    expect(cacheCovers(bars, "2025-03-01")).toBe(true);
    expect(cacheCovers(bars, "2025-01-01")).toBe(true);
  });
  it("false when the cache starts after `from` (misses older history)", () => {
    expect(cacheCovers(bars, "2024-06-01")).toBe(false);
  });
  it("false for a 1-bar or empty or non-array cache", () => {
    expect(cacheCovers([bars[0]], "2024-01-01")).toBe(false);
    expect(cacheCovers([], "2024-01-01")).toBe(false);
    expect(cacheCovers(null, "2024-01-01")).toBe(false);
  });
});
```

(The null-OHLC filter in `fetchOhlc` is network-bound and not separately
unit-tested here; its correctness is verified by reading + matching the proven
`toLiveBars` reference and `bunx tsc --noEmit`.)

Verification: `bun test pipeline/prices.test.ts` → all pass.

## Done criteria

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0; `pipeline/prices.test.ts` exists with `cacheCovers` tests
- [ ] `fetchOhlc`'s filter checks all four of open/high/low/close
- [ ] The cache-hit branch uses `cacheCovers(...)` (earliest bar ≤ `from`), not the bare `length > 1` check
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `prices.ts` excerpts don't match the live file (drift).
- `bun test` has a pre-existing failure before you start.
- Removing the bare `length > 1` check would change behavior you don't
  understand — re-read the existing comment about truncated caches; `cacheCovers`
  subsumes it (it also returns false for `length <= 1`).

## Maintenance notes

- **Re-fetching is an operator action.** The cache-coverage change only takes
  effect when `prices` runs again for a creator (the per-creator price cache is
  overwritten; the frozen `data/prices/` store stays insert-only). Re-running
  `prices` → `score` → `bun run scripts/parity-check.ts` → `PARITY OK`.
- Existing per-creator price files that under-cover won't auto-heal until a
  re-fetch with a lower `from`. A reviewer may want to spot-check whether any
  current `data/creators/*/prices/*.json` starts later than that creator's
  earliest `postDate`.
- This plan is the upstream complement to Plan 003 (which makes scoring robust to
  under-coverage even if a stale cache slips through).
