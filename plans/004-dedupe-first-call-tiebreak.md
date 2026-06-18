# Plan 004: Break same-day ties in `dedupeFirstCall` so only one call is the "first"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- src/lib/scorecard.ts src/lib/scorecard.test.ts`
> If either changed, compare the "Current state" excerpts against the live code;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (CI gate)
- **Category**: bug
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

`dedupeFirstCall` marks a call as `isFirstCall` when its `postDate` equals the
earliest `postDate` seen for that ticker. `postDate` is **day-granular** and ties
are expected (a creator can post about the same ticker twice in one day; the
codebase explicitly notes `postDate` has ties — see the `ord` column comment in
`db/backfill.ts`). When two calls on the same ticker share the earliest date,
**both** get `isFirstCall: true`. `buildScorecard` then filters on `isFirstCall`,
so that ticker is **double-weighted** in `hitRate`, `avgExcess`, `best`/`worst`,
and `callsPerWeek`, and the funnel's "First call (unique ticker)" count exceeds
the true unique-ticker count.

The fix: pick exactly one winner per ticker deterministically (earliest date, ties
broken by source order), so `isFirstCall` is true for exactly one call per ticker.

## Current state

`src/lib/scorecard.ts` — the function (lines 23-30):

```ts
export function dedupeFirstCall(calls: Call[]): Call[] {
  const earliest = new Map<string, string>();
  for (const c of calls) {
    const prev = earliest.get(c.ticker);
    if (!prev || c.postDate < prev) earliest.set(c.ticker, c.postDate);
  }
  return calls.map(c => ({ ...c, isFirstCall: earliest.get(c.ticker) === c.postDate }));
}
```

The Map holds ticker → earliest `postDate`. The final `.map` sets `isFirstCall`
by comparing each call's `postDate` to that earliest date — so every same-day call
matches.

- `Call` (`src/lib/types.ts:7-19`) has `shortcode: string`, `postDate: string`,
  `ticker: string`, `isFirstCall: boolean`, and a `returns` record.
- Callers: `buildScorecard(calls)` (`scorecard.ts:36-37`) does
  `const first = calls.filter(c => c.isFirstCall)`. `pipeline/score.ts:30`:
  `calls = dedupeFirstCall(calls)` (the input order is source order — bullish
  calls mapped from `reelCalls`, which preserve file order).
- **Source order is the right tiebreaker.** The input `calls` array is in source
  order; the DB layer preserves it via an `ord` column. Within the same ticker
  and same earliest date, the *first occurrence in the array* should win.

### Existing tests (`src/lib/scorecard.test.ts`) — must still pass

```ts
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
```
This uses distinct dates → still passes with the fix (AAA's earliest is the
06-01... here 01-01 — one winner). `buildScorecard` tests use distinct dates too.
The `call()` factory (lines 5-12) defaults `shortcode: "x"` for every call, so
**don't** rely on `shortcode` uniqueness as the tiebreaker — use array index.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `bunx tsc --noEmit`                  | exit 0              |
| Unit test | `bun test src/lib/scorecard.test.ts` | all pass            |
| Full      | `bun test`                           | all pass            |

## Scope

**In scope**:
- `src/lib/scorecard.ts` (only `dedupeFirstCall`)
- `src/lib/scorecard.test.ts`

**Out of scope** (do NOT touch):
- `buildScorecard`, `buildFunnel`, `minDate`/`maxDate` — unchanged.
- `pipeline/score.ts` — the caller is fine.
- Committed datasets — do not regenerate (see Maintenance notes).

## Git workflow

- Branch: `advisor/004-first-call-tiebreak`
- Commit message: conventional commits (e.g.
  `fix(scorecard): one first-call per ticker on same-day ties`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite `dedupeFirstCall` to pick one winner index per ticker

Track the *winning array index* per ticker (earliest date; on a tie, the lower
index wins because we only replace on a strictly-earlier date). Then set
`isFirstCall` by index identity, not date equality:

```ts
export function dedupeFirstCall(calls: Call[]): Call[] {
  // Winning index per ticker: earliest postDate; ties (same day) broken by source
  // order (the first occurrence wins, since we replace only on a strictly-earlier date).
  const winner = new Map<string, number>();
  calls.forEach((c, i) => {
    const prev = winner.get(c.ticker);
    if (prev === undefined || c.postDate < calls[prev]!.postDate) winner.set(c.ticker, i);
  });
  return calls.map((c, i) => ({ ...c, isFirstCall: winner.get(c.ticker) === i }));
}
```

Why index, not `shortcode`: `Call` always has a `shortcode`, but it is not
guaranteed unique in test fixtures, and index identity is unambiguous and matches
"first occurrence in source order."

**Verify**: `bunx tsc --noEmit` → exit 0; `bun test src/lib/scorecard.test.ts` →
existing tests still pass.

### Step 2: Add a same-day tie regression test

In `src/lib/scorecard.test.ts`, add:

```ts
test("dedupeFirstCall picks exactly one first-call when two share the earliest day", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-01-01", shortcode: "first" }),
    call({ ticker: "AAA", postDate: "2026-01-01", shortcode: "second" }),
    call({ ticker: "AAA", postDate: "2026-02-01", shortcode: "later" }),
  ];
  const flagged = dedupeFirstCall(calls).filter(c => c.isFirstCall);
  expect(flagged.length).toBe(1);
  expect(flagged[0]!.shortcode).toBe("first"); // earliest day, first in source order
});
```

(The `call()` factory accepts a `shortcode` via its `Partial<Call>` override.)

**Verify**: `bun test src/lib/scorecard.test.ts` → all pass (old + new).

## Test plan

- New test: two same-day calls on one ticker → exactly one `isFirstCall`, and it's
  the first in source order.
- Existing tests (distinct-date dedupe, scorecard averaging, hitRateN, funnel)
  unchanged and passing.
- Verification: `bun test` → all pass.

## Done criteria

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0
- [ ] For two same-day same-ticker calls, exactly one has `isFirstCall: true` (new test passes)
- [ ] Existing `scorecard.test.ts` tests pass unchanged
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `dedupeFirstCall` excerpt doesn't match the live file (drift).
- An existing `scorecard.test.ts` test fails after the change (re-read it; the
  distinct-date tests should be unaffected — investigate before adjusting).
- `bun test` has a pre-existing failure before you start.

## Maintenance notes

- **Re-scoring is a separate operator step.** Committed datasets are not
  regenerated here; the fix applies on the next `score` run, followed by
  `bun run scripts/parity-check.ts` → `PARITY OK`.
- If a future change adds an explicit `ord`/sequence field to `Call` (it exists
  on the DB `calls` row but not the in-memory `Call` type), prefer breaking ties
  by that field over array index, since array order then equals `ord` only if the
  caller sorted by it. Today the caller passes source order, so index is correct.
- A reviewer should confirm `buildScorecard`'s `first.length`-based stats
  (`callsPerWeek`, funnel "First call") now equal the unique-ticker count for the
  affected creators.
