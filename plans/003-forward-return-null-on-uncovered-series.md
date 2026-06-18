# Plan 003: Return null (not a fake 0%) when the price series doesn't cover a call's horizon

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- src/lib/returns.ts src/lib/returns.test.ts`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (CI gate)
- **Category**: bug
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

`forwardReturn` resolves both the start and end prices with `closeOnOrAfter`,
which returns the **first bar at or after** a target date. When a ticker's price
series begins *after* `postDate + horizon` (a recently-listed ticker, a
ticker-symbol change, or a too-short cached series — see Plan 006), both the
start and end resolve to the **same first bar**, so the function returns exactly
`0` (a "no change") instead of `null` ("no data for this horizon"). A fabricated
`0%` stock return then produces a non-null `excess` (`stock − spy`), so the call
enters the scorecard's hit-rate denominator and `avgExcess` with invented data
that should have been excluded.

`toDateReturn` has a milder version: a late-starting series anchors "start" at a
bar well after `postDate`, measuring the return from the wrong date rather than
returning `null`.

The fix: a return is only valid if the resolved start bar is actually *near* the
intended `fromDate` (i.e. the series covers the window), and the resolved end bar
is actually *at or after the horizon target* and *distinct from / later than* the
start. When the series doesn't cover the window, return `null` so the call is
correctly excluded.

## Current state

`src/lib/returns.ts` (full file is short — 52 lines). Relevant excerpts:

```ts
export function closeOnOrAfter(ohlc: OhlcBar[], target: string): number | null {
  for (const bar of ohlc) {
    if (bar.date >= target) return bar.c;
  }
  return null;
}

function pctReturn(from: number, to: number): number {
  return to / from - 1;
}

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
```

- `closeOnOrAfter` returns a **close price** (`number`), not the bar — so today
  the caller can't see *which date* it resolved to. The fix needs the resolved
  bar's date. Bars are sorted ascending by `date` (ISO `YYYY-MM-DD` strings; the
  scoring store is daily Yahoo OHLC).
- `OhlcBar` (`src/lib/types.ts:4`): `{ date: string; o,h,l,c: number }`.
- `addDays(iso, days)` (lines 7-11) does UTC date arithmetic and returns an ISO
  `YYYY-MM-DD` string.
- `closeOnOrAfter` is **also exported and unit-tested independently** — keep its
  signature and behavior unchanged (tests at `returns.test.ts:14-22` assert it
  returns a number/null). Add a *new* internal helper for the bar instead.

### Existing tests (`src/lib/returns.test.ts`) — must still pass

```ts
const bars: OhlcBar[] = [
  { date: "2026-06-01", ... c: 100 }, { date: "2026-06-02", ... c: 101 },
  { date: "2026-06-03", ... c: 102 }, { date: "2026-06-04", ... c: 103 },
  { date: "2026-06-05", ... c: 104 }, { date: "2026-06-08", ... c: 110 },
];
// closeOnOrAfter same-day → 101; weekend roll-forward "2026-06-06" → 110; past last "2026-06-09" → null
// forwardReturn(bars, "2026-06-01", 7) ≈ 0.10   (start=100 @06-01, end=110 @06-08)
// forwardReturn(bars, "2026-06-05", 30) → null  (06-05 + 30d = 07-05, past last bar)
// computeReturns(... "2026-06-01") → 1w stock 0.10, toDate stock 0.10
```

Note the existing happy-path: `forwardReturn(bars, "2026-06-01", 7)` must stay
`≈0.10`. `fromDate` (06-01) equals the first bar's date, and the 7-day target
(06-08) lands exactly on the last bar — so the new coverage guard must NOT reject
this case.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `bunx tsc --noEmit`              | exit 0              |
| Unit test | `bun test src/lib/returns.test.ts` | all pass          |
| Full      | `bun test`                       | all pass            |

## Scope

**In scope**:
- `src/lib/returns.ts`
- `src/lib/returns.test.ts`

**Out of scope** (do NOT touch):
- `src/lib/scorecard.ts`, `pipeline/score.ts` — they consume `computeReturns`
  output and already handle `null` correctly (they filter `excess != null`).
- `src/lib/spark.ts` — unrelated.
- The committed datasets — do not regenerate (see Maintenance notes).
- `closeOnOrAfter`'s exported signature — leave it as-is.

## Git workflow

- Branch: `advisor/003-forward-return-coverage`
- Commit message style: conventional commits (e.g.
  `fix(returns): null instead of fake 0% when series misses the horizon`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a helper that returns the resolved bar (date + close)

In `src/lib/returns.ts`, add an internal helper alongside `closeOnOrAfter` (do
not modify `closeOnOrAfter` itself):

```ts
// The first bar at or after `target`, or null if none. Used where the resolved
// date matters (coverage checks), unlike closeOnOrAfter which returns only the close.
function barOnOrAfter(ohlc: OhlcBar[], target: string): OhlcBar | null {
  for (const bar of ohlc) {
    if (bar.date >= target) return bar;
  }
  return null;
}
```

**Verify**: `bunx tsc --noEmit` → exit 0.

### Step 2: Rewrite `forwardReturn` with a coverage guard

The window `[fromDate, fromDate+calendarDays]` is only measurable if a bar exists
*at or after the horizon end target*. If the first bar at/after `fromDate` is
itself already past the horizon-end target, the series starts too late and there
is no real "before" price for this call → return `null`.

```ts
export function forwardReturn(ohlc: OhlcBar[], fromDate: string, calendarDays: number): number | null {
  const startBar = barOnOrAfter(ohlc, fromDate);
  if (startBar == null) return null;
  const endTarget = addDays(fromDate, calendarDays);
  const endBar = barOnOrAfter(ohlc, endTarget);
  if (endBar == null) return null;
  // Coverage guard: if the first available bar already sits at/after the horizon
  // end, the series begins after the window — there is no genuine "start" price,
  // so the horizon is unmeasurable (return null, not a fabricated 0%).
  if (startBar.date >= endTarget) return null;
  return pctReturn(startBar.c, endBar.c);
}
```

Check against the existing happy-path: `fromDate="2026-06-01"`, `calendarDays=7`
→ `endTarget="2026-06-08"`, `startBar.date="2026-06-01"` which is `< "2026-06-08"`,
so the guard passes and the result is `pctReturn(100, 110) ≈ 0.10`. ✅

**Verify**: `bun test src/lib/returns.test.ts` → existing tests still pass.

### Step 3: Add a coverage guard to `toDateReturn`

`toDateReturn` measures from the call date to the last bar. If the series starts
after `fromDate`, the start price is anchored at the wrong (later) date. Guard:
the start bar must be reasonably close to `fromDate`. Use the same principle —
the start bar must not be after a short grace window past `fromDate` (markets
have weekends/holidays; allow a few days). A 7-day grace matches the shortest
horizon and the weekend-roll-forward already in the tests:

```ts
function toDateReturn(ohlc: OhlcBar[], fromDate: string): number | null {
  if (ohlc.length === 0) return null;
  const startBar = barOnOrAfter(ohlc, fromDate);
  if (startBar == null) return null;
  // If the first bar at/after the call date is more than a week later, the series
  // doesn't cover the call — measuring "to date" from it would use the wrong anchor.
  if (startBar.date > addDays(fromDate, 7)) return null;
  const last = ohlc[ohlc.length - 1].c;
  return pctReturn(startBar.c, last);
}
```

**Verify**: `bun test src/lib/returns.test.ts` → all pass (the existing
`computeReturns ... toDate ≈ 0.10` case: start bar 06-01 ≤ 06-08, passes).

### Step 4: Add regression tests

In `src/lib/returns.test.ts`, add cases (reuse the `bars` fixture; add a
late-starting fixture):

```ts
const lateBars: OhlcBar[] = [
  // series begins 2026-07-01, well after a call on 2026-06-01
  { date: "2026-07-01", o: 200, h: 200, l: 200, c: 200 },
  { date: "2026-07-02", o: 210, h: 210, l: 210, c: 210 },
];

test("forwardReturn is null when the series starts after the horizon window", () => {
  // call 2026-06-01, 1w horizon ends 2026-06-08, but first bar is 2026-07-01
  expect(forwardReturn(lateBars, "2026-06-01", 7)).toBeNull();
});

test("toDateReturn is null when the series starts long after the call date", () => {
  expect(toDateReturn(lateBars, "2026-06-01")).toBeNull();
});
```

Note: `toDateReturn` is not exported today (it's only used via `computeReturns`).
Either (a) export it for the test, or (b) assert through `computeReturns`:
```ts
test("computeReturns yields null toDate when series starts after the call", () => {
  const r = computeReturns(lateBars, lateBars, "2026-06-01");
  expect(r["toDate"].stock).toBeNull();
  expect(r["1w"].stock).toBeNull();
});
```
Prefer (b) — it tests the public surface and needs no export change. Use (b)
unless you have a reason to export `toDateReturn`.

**Verify**: `bun test src/lib/returns.test.ts` → all pass (old + new).

## Test plan

- New tests: late-starting series → `forwardReturn` null, `computeReturns` toDate
  null. Existing happy-path + weekend-roll + horizon-not-elapsed tests unchanged
  and still passing.
- Verification: `bun test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0
- [ ] `forwardReturn` returns `null` for a series whose first bar is at/after the horizon-end target (new test passes)
- [ ] The existing `returns.test.ts` tests (≈0.10 happy path, weekend roll-forward, null-when-not-elapsed) still pass unchanged
- [ ] `closeOnOrAfter`'s signature and behavior are unchanged (`git diff` shows no edit to it)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `returns.ts` excerpts don't match the live file (drift).
- Adding the coverage guard breaks an existing `returns.test.ts` assertion you
  did not expect to change — re-read the test, do not "fix" it by loosening the
  guard until you understand why.
- `bun test` has a pre-existing failure before you start.

## Maintenance notes

- **Re-scoring is a separate operator step.** This changes how *future* scoring
  treats uncovered horizons; committed datasets are not regenerated here. After
  this lands, re-running `score` for affected creators (then
  `bun run scripts/parity-check.ts` → `PARITY OK`) will drop the previously
  fabricated `0%` entries from hit-rates. Expect published hit-rate/avgExcess
  numbers to shift slightly for any creator who called a then-unlisted ticker.
- This bug compounds with Plan 006 (price cache ignoring coverage): fixing the
  cache reduces how often a too-short series reaches scoring, but this guard is
  the correctness backstop regardless.
- A reviewer should sanity-check the 7-day grace in `toDateReturn` against real
  data (holiday weeks can exceed a 3-day gap; 7 covers the worst case).
