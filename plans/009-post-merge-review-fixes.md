# Plan 009 — Post-merge holistic-review fixes

Written against commit `69c94f0` (= current `origin/main`, has all of plans 001–008 merged).
Source: a Fable-5 holistic review of the combined `9af3f0c..HEAD` diff found issues that
per-branch review structurally could not see (they emerge only from the *combination* + the
Linux CI runner). All four ranked findings are confirmed real. Fix all four plus three minors.

**Verification gates:** `bunx tsc --noEmit` (exit 0) and `bun test` (0 fail). The `#/` alias = `src/`.
Tests import `bun:test`. After your changes, ALSO run the specific repro in step 1 to prove the
CI-only failure is gone locally.

**STOP conditions:** if any assumption below is false in the code you see, STOP and report —
do not improvise. Specifically: if `pipeline/calls.ts` does not throw `Error` messages that
start with `"classify:"`, or if `mergePrices` is not existing-wins, stop.

---

## Fix 1 (CRITICAL) — CI red on `main`: leaked test mock missing `inputValidator`

**Why:** `src/routes/api/routes.test.ts` and `src/lib/data.test.ts` each register
`mock.module("@tanstack/react-start", () => ({ createServerFn: () => ({ handler: ... }) }))`.
The stub has no `.inputValidator`. Bun module mocks are **process-global and leak across files**.
On the Linux CI runner a mocking file executes before `src/lib/chart-fetch.test.ts`, so
`src/lib/chart-fetch.ts:106` calls `.inputValidator(...)` on the stub →
`TypeError: ...inputValidator is not a function` → 2 fail / 2 errors. macOS file order dodges it,
so it's green locally. CI runs 27395616949 + 27397898732 both failed on exactly this.

**Change (both files):** make the `createServerFn` stub return a chainable, API-complete builder.
In **`src/routes/api/routes.test.ts`** (the mock near line 8) and **`src/lib/data.test.ts`**
(near line 6), replace the stub body with:

```ts
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      inputValidator: () => b,
      middleware: () => b,
      handler: (fn: unknown) => fn,
    };
    return b;
  },
}));
```

Keep each file's existing surrounding comment. Do not touch any other line in these files.

**Repro (must pass after the fix — this is the file order that detonates on CI):**
`bun test src/lib/data.test.ts src/lib/chart-fetch.test.ts src/lib/chart-query.test.ts`
→ 0 fail, no "Unhandled error between tests".

---

## Fix 2 (IMPORTANT) — `pipeline/prices.ts` refetch silently restates frozen scored bars

**Why:** Plan 006 widened the refetch trigger (`cacheCovers`) so it also fires when a
newly-discovered older call lowers `from` below the cache's earliest bar — a routine event.
The refetch path then does `fetchOhlc(t, from)` + `writeFile(out, JSON.stringify(ohlc))`,
which **overwrites the whole per-creator cache** with fresh Yahoo data. That can replace frozen,
already-scored bars with split/dividend-restated values — violating the repo's insert-only price
invariant (`src/lib/prices-merge.ts` existing-wins, DB `prices` INSERT-only, the owner-only
restatement runbook in CLAUDE.md). After refetch + re-score the dataset would use restated bars
while the shared store + DB keep frozen ones, and `backfillPrices` would warn on every divergence.

**Change:** on refetch, merge **existing-wins** so only genuinely-new dates are appended; frozen
bars are never rewritten. Current loop body (`pipeline/prices.ts` ~lines 31–52):

```ts
    const out = join(pricesDir(handle), `${t}.json`);
    if (existsSync(out)) {
      try {
        const cached = JSON.parse(await readFile(out, "utf8"));
        if (cacheCovers(cached, from)) continue;
        console.warn(`REFETCH ${t}: cache misses coverage (...)`);
      } catch {
        console.warn(`REFETCH ${t}: unreadable cache`);
      }
    }
    try {
      const ohlc = await fetchOhlc(t, from);
      if (!ohlc.length) { console.warn(`FLAG ${t}: no price data`); continue; }
      await writeFile(out, JSON.stringify(ohlc));
      console.log(`prices ${t}: ${ohlc.length} bars`);
    } catch (e) { console.warn(`FLAG ${t}: ${(e as Error).message}`); }
```

Hoist the parsed cache so it's available at write time, and merge:

- Add the import: `import { mergePrices } from "../src/lib/prices-merge";` (match the existing
  relative-path import style in this file — it uses `../src/lib/types`).
- Declare `let cachedBars: OhlcBar[] = [];` before the `if (existsSync(out))` block.
- In the `try`, after parsing, set `cachedBars = Array.isArray(cached) ? cached : [];` before the
  `cacheCovers` check (so a covered cache still `continue`s unchanged).
- In the refetch write, replace `const ohlc = await fetchOhlc(t, from);` +
  `await writeFile(out, JSON.stringify(ohlc));` with:

```ts
      const fetched = await fetchOhlc(t, from);
      if (!fetched.length) { console.warn(`FLAG ${t}: no price data`); continue; }
      // Existing-wins merge: never rewrite a frozen scored bar; append only new dates.
      const ohlc = mergePrices(cachedBars, fetched);
      await writeFile(out, JSON.stringify(ohlc));
      console.log(`prices ${t}: ${ohlc.length} bars`);
```

(The empty-result guard now checks `fetched`, not the merged result.)

**Test:** add a case to `pipeline/prices.test.ts` for `cacheCovers` is already there; add a
unit test asserting the merge semantics at the prices layer is hard without network. Instead add
a focused test that `mergePrices` is existing-wins on an OHLC collision IF one does not already
exist in `src/lib/prices-merge.test.ts` — check first; if covered, note it and add none. Do not
mock Yahoo. The `cacheCovers` tests already gate the trigger; the invariant is enforced by
`mergePrices`, which has its own tests.

---

## Fix 3 (IMPORTANT) — `pipeline/extract.ts` hand-merged catch is too broad

**Why:** `classify()`'s contract (its own doc comment) is "throws on an unreadable reply so the
caller's retry loop re-runs the post." The X path honors that (heal loop retries un-done tweets).
The IG loop (`pipeline/extract.ts` ~lines 38–44) has **no retry** and its blanket `catch` swallows
*every* throw — an exhausted-backoff 429, a network outage, an unset `GROQ_API_KEY` (thrown lazily
inside `groq()` at `pipeline/groq.ts`) — logs "skip", and lets the run finish, writing a silently
incomplete `reel-calls.json`. Before plan 002 those errors crashed loudly.

`classify()` throws only two deliberate, parse-level messages, both prefixed `"classify:"`
(`pipeline/calls.ts:66` `"classify: missing choices/content in LLM reply"`, `:72`
`"classify: reply content was not valid JSON"`). Skip only those; rethrow everything else.

**Change:** current catch:

```ts
    let c;
    try {
      c = await classify(text, body);
    } catch (e) {
      console.warn(`skip ${code}: classify failed — ${(e as Error).message}`);
      continue;
    }
```

becomes:

```ts
    let c;
    try {
      c = await classify(text, body);
    } catch (e) {
      // classify() throws "classify: ..." only on an unparseable reply (skip the post).
      // Transport/auth failures (429 past backoff, network, missing GROQ_API_KEY) are NOT
      // per-post and must surface loudly, not silently truncate reel-calls.json.
      if (!(e as Error).message.startsWith("classify:")) throw e;
      console.warn(`skip ${code}: unparseable classify reply — ${(e as Error).message}`);
      continue;
    }
```

**Also (minor, same file): reorder so the free local check runs before the paid call.**
`postDateOf` is a local file read; `classify` is the rate-limited LLM call. Currently classify
runs first, so a reel with no `upload_date` burns a Groq call then gets skipped. Move the
`postDate` computation + null-skip ABOVE the classify try/catch:

```ts
    const postDate = await postDateOf(handle, code);
    if (postDate == null) { console.warn(`skip ${code}: no upload_date in info.json`); continue; }
    let c;
    try { c = await classify(text, body); }
    catch (e) { /* as above */ }
    const rc = toReelCall(c, code, postDate);
    if (rc) out.push(rc);
```

**Test:** add to `pipeline/extract.test.ts` — if the test harness can inject a `classify` that
throws, assert a `"classify:"`-prefixed throw is swallowed (loop continues) and a non-prefixed
throw propagates out of `extract`. If `extract` does not accept an injectable classifier (it
imports `classify` directly), do NOT refactor production code just to test it — instead unit-test
the discriminator logic is trivially the prefix check; note in the plan status that the behavior
is covered by inspection + the existing extract tests, and add no brittle test. Prefer no test
over a bad one.

---

## Fix 4 (IMPORTANT) — `src/lib/chart-fetch.ts` input validation gap

**Why:** `InputSchema` (chart-fetch.ts ~line 99) is `symbol: z.string().min(1).max(12)` —
accepts `/`, `..`, `:`, `%`. `yahoo-finance2` concatenates the raw symbol into the URL path
**unencoded**, so a crafted symbol reshapes the request path (host-confined SSRF + cache-key
pollution). And `firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, ...)` is **unanchored with no
length cap** — `"2026-01-01" + 10MB` passes, lands verbatim in the "All" cache key, and yields
`new Date(...)` = Invalid Date.

`isSafeAssetKey` already exists and is correct (`src/lib/api-serve.ts:13`,
`/^[A-Za-z0-9.$!_-]{1,40}$/` — verified to accept all 215 committed symbols incl. `$ETH.X`,
`SI1!`, `BTC-USD`, and reject `/ ? # \ %` + null bytes). Reuse it.

**Change:**
- Import it: `import { isSafeAssetKey } from "#/lib/api-serve";` (or the matching relative path used
  by other imports in chart-fetch.ts — check the file's existing import style and match it).
- `symbol: z.string().min(1).max(40).refine(isSafeAssetKey, "unsafe symbol")`
- `firstDate: z.string().max(30).regex(/^\d{4}-\d{2}-\d{2}($|T)/, "firstDate must be YYYY-MM-DD")`

The committed `firstDate` values are plain `YYYY-MM-DD`; the `($|T)` also tolerates an ISO
datetime suffix. Anchoring the end is the fix — the `.max(30)` caps the cache-key/`new Date` input.

**Test:** add to `src/lib/chart-fetch.test.ts` — `InputSchema.safeParse` (export `InputSchema`
if not already exported; it currently is not — add `export` to the `const InputSchema`):
rejects `symbol: "../etc"`, `symbol: "A/B"`, and an over-long `firstDate`; accepts
`symbol: "$ETH.X"` + `firstDate: "2026-01-01"`. Follow the existing test style in that file
(`describe`/`test` from `bun:test`).

---

## Minor fixes (do all three)

**M1 — conviction is reset, not clamped (`pipeline/calls.ts:37`).**
`conviction: z.number().min(0).max(1).catch(0)` turns `2` (high conviction) into `0` (lowest).
Conviction is display-only (scoring gates on `isExplicitBuy && direction==="bullish"`), but a real
clamp preserves the signal. Change to:
`conviction: z.number().catch(0).transform((v) => Math.min(1, Math.max(0, v)))`
(non-numeric → `.catch(0)`; out-of-range number → clamped). Then update the test
`pipeline/calls.test.ts:47-49` ("clamps an out-of-range conviction") to expect `1`, not `0`:
`expect(c.conviction).toBe(1);` — and confirm the `conviction: 2` input now yields `1`.

**M2 — pin Bun in CI (`.github/workflows/ci.yml`).** Both jobs use `bun-version: latest` (lines
~23 and ~33). A Bun release can flip CI with zero repo change. Pin both to `1.3.14` (the version
CI currently resolves `latest` to).

**M3 — SKIP the "warn on each coerced Zod field" suggestion.** The reviewer floated rewriting
every `.catch(default)` into a `.catch((ctx) => { console.warn(...); return default })` form so
silent coercions are logged. Advisor decision: **do not do this** — it touches every field, adds
noise, and the failure mode is already safe (coerces toward not-scoring). Record this as
deliberately skipped in the status; do not implement.

---

## Done criteria (all must hold)
1. `bunx tsc --noEmit` → exit 0.
2. `bun test` → 0 fail (skips allowed).
3. The Fix-1 repro `bun test src/lib/data.test.ts src/lib/chart-fetch.test.ts src/lib/chart-query.test.ts`
   → 0 fail, no "Unhandled error between tests".
4. Every change above present; M3 deliberately absent.

## Out of scope (do not touch)
- `data/creators/**`, `data/prices/**`, `public/**` — no data regeneration.
- Re-scoring — that's a separate operator step.
- Any file not named above.

## Status
DONE — merged to `main` (commit `6029f1f`, ff from `69c94f0`) and pushed to `origin/main`.
Executed by a fresh-context Fable executor in an isolated worktree, advisor-reviewed (diff +
re-run done criteria), then merged. Verification on the merged tree: `bunx tsc --noEmit` exit 0;
`bun test` 140 pass / 20 skip / 0 fail (160 tests); Fix-1 repro 12 pass / 0 fail. M3 deliberately
skipped (see above). Source: Fable-5 holistic review of the combined plans-001–008 diff.
