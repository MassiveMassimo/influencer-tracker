# Plan 007: Make the X extract checkpoint crash-safe (no duplicate calls)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- pipeline/x/extract-x.ts pipeline/x/extract-x.test.ts`
> If either changed, compare the "Current state" excerpts against the live code;
> on a mismatch, treat it as a STOP condition. **Note**: Plan 002 also edits
> `pipeline/x/extract-x.ts` (the `tweetToReelCall` null-handling). If 002 has
> landed, the file will differ from the excerpt below in that one function —
> that's expected; this plan touches different parts (load + push + persist).

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (CI gate). Sequence after 002 if both are queued (shared file).
- **Category**: bug
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

`extractX` checkpoints progress with two sequential, non-atomic writes:
`writeCalls(handle, out)` (the results) then `writeFile(donePath, ...)` (the
progress set). If the process crashes **between** them, the results file has the
new calls but the progress file does not. On the next run, `out` is reloaded
_with_ those calls, but `done` is reloaded _without_ their ids — so those tweets
are re-extracted and their calls are **appended again**, duplicating rows. The
downstream DB backfill (`scripts/backfill.ts`) asserts a row-count match and
**throws** on the duplicate (the PK `(handle, shortcode)` merges it), forcing a
manual de-dup of `reel-calls.json` before any backfill can succeed.

The fix is cheap and robust: de-duplicate by `shortcode` (the tweet id) both when
loading `out` and when pushing into it, so a re-processed tweet can never produce
a second row.

## Current state

`pipeline/x/extract-x.ts` — relevant excerpts (line numbers at commit `fa39041`):

```ts
// lines 52-54: load prior results
const out: ReelCall[] = existsSync(join(creatorDir(handle), "reel-calls.json"))
  ? JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"))
  : [];

// lines 65-73: the non-atomic checkpoint
let writeChain: Promise<void> = Promise.resolve();
const persist = () => {
  writeChain = writeChain.then(async () => {
    await writeCalls(handle, out);                                // durable results
    await writeFile(donePath, JSON.stringify([...done]));         // durable progress
  });
  return writeChain;
};

// lines 85-100: the worker pushes rc into out
const worker = async () => {
  while (next < pending.length) {
    const t = pending[next++];
    try {
      const rc = await tweetToReelCall(t, handle, deps);
      if (rc) out.push(rc);
      done.add(t.id);
    } catch (e) {
      console.warn(`skip ${t.id}: ${(e as Error).message}`);
    }
    if (++completed % 20 === 0) { await persist(); ... }
  }
};
```

- `ReelCall.shortcode` (`src/lib/types.ts:46`) is the tweet id on the X path
  (`toReelCall(c, t.id, ...)`), so it uniquely identifies a call.
- `writeCalls` (`pipeline/calls.ts:82-85`) writes `reel-calls.json` +
  `calls.review.md`. Out of scope to change.
- `scripts/backfill.ts` is the consumer that throws on the row-count mismatch
  (the symptom). Out of scope — the fix is at the source.

## Commands you will need

| Purpose   | Command                                 | Expected on success |
| --------- | --------------------------------------- | ------------------- |
| Typecheck | `bunx tsc --noEmit`                     | exit 0              |
| Unit test | `bun test pipeline/x/extract-x.test.ts` | all pass            |
| Full      | `bun test`                              | all pass            |

## Scope

**In scope**:

- `pipeline/x/extract-x.ts`
- `pipeline/x/extract-x.test.ts`

**Out of scope** (do NOT touch):

- `pipeline/calls.ts` (`writeCalls`), `scripts/backfill.ts`, `db/backfill.ts`.
- The worker/heal-loop control flow — only the load and push are changed.
- Committed `reel-calls.json` / datasets — do not regenerate.

## Git workflow

- Branch: `advisor/007-extract-x-dedup`
- Commit message: conventional commits (e.g.
  `fix(extract-x): dedup calls by id so a crashed checkpoint can't duplicate`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a pure `dedupeByShortcode` helper (exported for tests)

Add near the top of `pipeline/x/extract-x.ts` (after imports):

```ts
// Collapse duplicate calls by shortcode (tweet id), keeping the first occurrence.
// Guards against a crash between the two checkpoint writes re-appending a call.
export function dedupeByShortcode(calls: ReelCall[]): ReelCall[] {
  const seen = new Set<string>();
  const result: ReelCall[] = [];
  for (const c of calls) {
    if (seen.has(c.shortcode)) continue;
    seen.add(c.shortcode);
    result.push(c);
  }
  return result;
}
```

**Verify**: `bunx tsc --noEmit` → exit 0.

### Step 2: Dedup on load and guard the push

Change the load (lines 52-54) to dedup immediately, and maintain a `seen` set so
the worker never pushes a duplicate:

```ts
const loaded: ReelCall[] = existsSync(join(creatorDir(handle), "reel-calls.json"))
  ? JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"))
  : [];
const out: ReelCall[] = dedupeByShortcode(loaded);
const seenCalls = new Set(out.map((c) => c.shortcode));
```

Change the worker push (line 90) so it only adds a not-yet-seen call:

```ts
const rc = await tweetToReelCall(t, handle, deps);
if (rc && !seenCalls.has(rc.shortcode)) {
  seenCalls.add(rc.shortcode);
  out.push(rc);
}
done.add(t.id);
```

(If Plan 002 has landed, the `tweetToReelCall` line is unchanged by it; only its
internals changed. Keep the `if (rc && !seenCalls...)` guard.)

This makes re-processing idempotent: a tweet whose id is already represented in
`out` (from a prior, partially-checkpointed run) cannot add a second row.

**Verify**: `bunx tsc --noEmit` → exit 0; `bun test pipeline/x/extract-x.test.ts`
→ existing tests still pass.

## Test plan

In `pipeline/x/extract-x.test.ts`, add a `describe("dedupeByShortcode", ...)`
block (import it from `./extract-x`):

```ts
import { dedupeByShortcode } from "./extract-x";
// ...
describe("dedupeByShortcode", () => {
  it("keeps the first occurrence and drops later duplicates by shortcode", () => {
    const mk = (shortcode: string, ticker: string): ReelCall => ({
      shortcode,
      postDate: "2026-01-01",
      ticker,
      company: "",
      direction: "bullish",
      isExplicitBuy: true,
      conviction: 0.5,
      quote: "",
      onScreenPrice: null,
      summary: "",
    });
    const out = dedupeByShortcode([mk("t1", "AAA"), mk("t1", "BBB"), mk("t2", "CCC")]);
    expect(out.map((c) => c.shortcode)).toEqual(["t1", "t2"]);
    expect(out[0]!.ticker).toBe("AAA"); // first occurrence wins
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeByShortcode([])).toEqual([]);
  });
});
```

(Import the `ReelCall` type: `import type { ReelCall } from "../../src/lib/types";`
— match the path used at the top of `extract-x.ts`.)

Verification: `bun test pipeline/x/extract-x.test.ts` → all pass.

## Done criteria

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0; `dedupeByShortcode` tests exist and pass
- [ ] `out` is deduped on load and the worker push is guarded by a `seen` set
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `extract-x.ts` load/persist/worker excerpts don't match the live file
  beyond the Plan-002 `tweetToReelCall` change noted above (unexpected drift).
- `bun test` has a pre-existing failure before you start.

## Maintenance notes

- This makes the checkpoint _idempotent_ rather than _atomic_ — simpler and
  sufficient. If a future change needs strict atomicity (e.g. a single combined
  checkpoint file), the dedup guard is still a correct safety net.
- A reviewer should confirm `seenCalls` is seeded from the deduped `out` (not the
  raw `loaded`), so a duplicate already in the file is collapsed once, not kept.
- Existing `reel-calls.json` files with pre-existing duplicates will be cleaned on
  the next `extractX` run (load → dedup → persist). No manual cleanup needed after
  this lands.
