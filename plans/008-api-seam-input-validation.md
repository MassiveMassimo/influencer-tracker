# Plan 008: Validate input on the public serve seams (route params, `firstDate`, cache bound, token compare)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fa39041..HEAD -- src/lib/chart-fetch.ts src/lib/chart-fetch.test.ts src/routes/api/dataset.\$handle.ts src/routes/api/prices.\$symbol.ts src/lib/api-serve.ts src/routes/api/revalidate.ts src/routes/api/routes.test.ts src/routes/api/revalidate.test.ts`
> If any changed, compare the "Current state" excerpts against the live code; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (CI gate)
- **Category**: security
- **Planned at**: commit `fa39041`, 2026-06-11

## Why this matters

The public read seams accept input with little or no validation. None is a
critical vulnerability today, but each is a hygiene gap on a code path any client
can reach:

1. **`fetchChart.firstDate` is `z.string()`** — any string. It (a) is part of an
   unbounded in-memory cache key, so unique values grow the module-level `Map`
   without a size cap, and (b) is fed to `new Date(...)`, so a malformed value
   becomes an Invalid Date passed to Yahoo as `period1` (opaque error instead of
   a clean rejection).
2. **API route params are interpolated raw** into a same-origin fetch
   (`staticFallback("/datasets/${handle}.json")`). An encoded param can reshape
   the upstream URL (limited, same-origin SSRF / asset-path traversal), and every
   distinct value mints a 6h ISR CDN entry + a function invocation (cache-fill
   lever).
3. **`safeCompare` sizes its buffers by `string.length` (UTF-16 code units), not
   byte length.** With ASCII tokens (the real case) it's correct; with a
   multibyte token it truncates before `timingSafeEqual`. Advisory hygiene.

The fix: validate `firstDate` as an ISO date, cap the chart cache, reject route
params that don't match a safe charset (404), and make the token compare
byte-safe.

## Current state

### 1. `src/lib/chart-fetch.ts`
```ts
// lines 44-60: module-level cache, no size cap
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; bars: LiveBar[] }>();
export function cacheGet(key: string, now: number): LiveBar[] | null { ... }
export function cacheSet(key: string, bars: LiveBar[], now: number): void {
  cache.set(key, { at: now, bars });
}

// lines 92-105: input schema + handler
const InputSchema = z.object({
  symbol: z.string().min(1).max(12),
  timeframe: z.enum(["1D", "1W", "1M", "3M", "6M", "1Y", "All"]),
  firstDate: z.string(), // ISO date of earliest call, used for the "All" window
});
export const fetchChart = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ChartData> => {
    ...
    const { interval, period1 } = chartWindow(tf, { now: new Date(), firstDate: new Date(data.firstDate) });
    ...
  });
```
`cacheGet` / `cacheSet` are unit-tested in `src/lib/chart-fetch.test.ts` with
explicit `now` and specific keys (`"AAPL:5m"`, `"X:1d"`, `"MISS:5m"`) — a size
cap with a high limit will not affect those tests.

### 2. `src/routes/api/dataset.$handle.ts` (and the parallel `prices.$symbol.ts`)
```ts
GET: async ({ params }) => {
  const handle = params.handle;
  if (import.meta.env.SSR) { ... readDataset(getDb(), handle) ... }
  return staticFallback(`/datasets/${handle}.json`, { onMiss: "error", label: `dataset ${handle}` });
}
```
`prices.$symbol.ts` is structurally identical with `symbol` →
`staticFallback("/prices/${symbol}.json", { onMiss: "empty", emptyBody: "[]" })`.
Existing tests in `src/routes/api/routes.test.ts` reach the GET handler
structurally via `getHandler(Route)({ params: { handle: "kevvonz" } })` and mock
`global.fetch` by path. Valid handles used in tests: `"kevvonz"`, `"SPY"`,
`"nope"`, `"NOPE"` — all match a safe charset, so adding param validation must
not reject them.

### 3. `src/lib/api-serve.ts` — `staticFallback(path, opts)` fetches
`siteUrl(path)`. A good place for a shared param validator helper.

### 4. `src/routes/api/revalidate.ts`
```ts
function safeCompare(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 32);
  const bufA = Buffer.alloc(len);
  const bufB = Buffer.alloc(len);
  bufA.write(a);
  bufB.write(b);
  return timingSafeEqual(bufA, bufB);
}
```
Tests in `src/routes/api/revalidate.test.ts` use ASCII tokens
(`"s3cret-token-value"`, `"wrong-token-value"`) and assert 503/401/401/200 — the
fix must preserve all four outcomes.

## Commands you will need

| Purpose   | Command                                      | Expected on success |
|-----------|----------------------------------------------|---------------------|
| Typecheck | `bunx tsc --noEmit`                          | exit 0              |
| Unit test | `bun test src/lib/chart-fetch.test.ts`       | all pass            |
| Unit test | `bun test src/routes/api/routes.test.ts`     | all pass            |
| Unit test | `bun test src/routes/api/revalidate.test.ts` | all pass            |
| Full      | `bun test`                                   | all pass            |

## Suggested executor toolkit

- `context7` for Zod v4 string/date validation if unsure.

## Scope

**In scope**:
- `src/lib/chart-fetch.ts` + `src/lib/chart-fetch.test.ts`
- `src/lib/api-serve.ts` (add a validator helper)
- `src/routes/api/dataset.$handle.ts`, `src/routes/api/prices.$symbol.ts`
- `src/routes/api/revalidate.ts`
- `src/routes/api/routes.test.ts` (add invalid-param cases)

**Out of scope** (do NOT touch):
- `src/lib/chart-window.ts`, `src/lib/db-read.ts`, `db/client.ts`.
- The `USE_DB` / DB branch logic in the routes — only the static-fallback param
  is validated.
- `vite.config.ts` routeRules (ISR config) — unchanged.

## Git workflow

- Branch: `advisor/008-api-input-validation`
- Commit message: conventional commits (e.g.
  `fix(api): validate serve-seam input (params, firstDate, cache cap, token compare)`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Validate `firstDate` as an ISO date in `chart-fetch.ts`

Tighten the schema so a non-date string is rejected at the validator boundary
(returns a server-fn validation error, not an Invalid Date):

```ts
firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "firstDate must start with YYYY-MM-DD"),
```

(Keep it permissive about a trailing time component if any caller sends a full
ISO datetime — the `^\d{4}-\d{2}-\d{2}` anchor accepts both `2026-06-01` and
`2026-06-01T00:00:00Z`.)

**Verify**: `bunx tsc --noEmit` → exit 0.

### Step 2: Add a size cap to the chart cache

In `cacheSet`, evict the oldest entry when over a fixed maximum. Keep the
signature unchanged (tests pass `now`):

```ts
const MAX_ENTRIES = 500; // generous: ~7 timeframes × symbols a real UI touches
export function cacheSet(key: string, bars: LiveBar[], now: number): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value; // Map preserves insertion order
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, bars });
}
```

**Verify**: `bun test src/lib/chart-fetch.test.ts` → existing tests still pass
(they set ≤2 keys, well under 500).

### Step 3: Add a shared param validator and reject bad params in both routes

In `src/lib/api-serve.ts`, add:

```ts
// A creator handle / ticker symbol is a short alphanumeric token. Reject anything
// else (encoded slashes, dots, query/fragment chars) before it reshapes the
// same-origin fetch URL or mints an ISR cache entry.
export function isSafeAssetKey(key: string): boolean {
  // Allows the `$` and `!` used by committed scored symbols ($ETH.X, SI1!) while
  // still rejecting path-traversal / URL-reshaping chars (/, ?, #, \, ..-with-slash).
  return /^[A-Za-z0-9.$!_-]{1,40}$/.test(key);
}
```

In `src/routes/api/dataset.$handle.ts`, at the very top of the GET handler
(before the SSR/DB branch), reject invalid handles with a 404:

```ts
const handle = params.handle;
if (!isSafeAssetKey(handle)) {
  return Response.json({ error: "invalid handle" }, { status: 404, headers: { "Cache-Control": CACHE_CONTROL } });
}
```
(Import `isSafeAssetKey` alongside the existing `CACHE_CONTROL, staticFallback`
import.)

Do the same in `src/routes/api/prices.$symbol.ts` for `symbol` (use the same
helper; return the same 404 JSON shape).

**Verify**: `bunx tsc --noEmit` → exit 0; `bun test src/routes/api/routes.test.ts`
→ existing tests still pass (handles `kevvonz`/`SPY`/`nope`/`NOPE` all match the
charset).

### Step 4: Add invalid-param route tests

In `src/routes/api/routes.test.ts`, add (model on the existing miss tests; no
fetch mock needed — validation returns before any fetch):

```ts
test("GET /api/dataset/$handle → 404 on an unsafe handle (no upstream fetch)", async () => {
  globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
  const { Route } = await import("./dataset.$handle");
  const res = await getHandler(Route)({ params: { handle: "../secret" } });
  expect(res.status).toBe(404);
});

test("GET /api/prices/$symbol → 404 on an unsafe symbol (no upstream fetch)", async () => {
  globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
  const { Route } = await import("./prices.$symbol");
  const res = await getHandler(Route)({ params: { symbol: "a/b" } });
  expect(res.status).toBe(404);
});
```
(The `afterEach` in that file already restores `globalThis.fetch`.)

**Verify**: `bun test src/routes/api/routes.test.ts` → all pass (old + new).

### Step 5: Make `safeCompare` byte-safe in `revalidate.ts`

Size the buffers by byte length so a multibyte token can't be truncated. Minimal
change:

```ts
function safeCompare(a: string, b: string): boolean {
  const len = Math.max(Buffer.byteLength(a), Buffer.byteLength(b), 32);
  const bufA = Buffer.alloc(len);
  const bufB = Buffer.alloc(len);
  bufA.write(a);
  bufB.write(b);
  return timingSafeEqual(bufA, bufB);
}
```

(`Buffer.write` defaults to UTF-8, matching `byteLength`.)

**Verify**: `bun test src/routes/api/revalidate.test.ts` → all four tests
(503/401/401/200) still pass.

## Test plan

- `chart-fetch.test.ts`: existing cache tests unchanged (cap is far above their 2
  keys). No new test strictly required for the cap; optionally add one asserting
  that inserting `MAX_ENTRIES + 1` distinct keys keeps `cacheGet` of the first
  inserted key null — include it only if quick.
- `routes.test.ts`: two new 404-on-unsafe-param tests (Step 4).
- `revalidate.test.ts`: unchanged; must still pass (Step 5).
- Verification: `bun test` → all pass.

## Done criteria

- [ ] `bunx tsc --noEmit` exits 0
- [ ] `bun test` exits 0
- [ ] `fetchChart`'s `firstDate` is validated against an ISO-date regex
- [ ] `cacheSet` evicts the oldest entry past a fixed cap
- [ ] Both `dataset.$handle` and `prices.$symbol` return 404 on an unsafe param without fetching (new tests pass)
- [ ] `safeCompare` sizes buffers by `Buffer.byteLength`; the four revalidate auth tests still pass
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Any "Current state" excerpt doesn't match the live file (drift).
- Adding `isSafeAssetKey` rejects a handle/symbol that an existing test or a real
  committed creator uses (check `data/creators/index.json` handles match
  `^[A-Za-z0-9._-]{1,40}$` — they do at `fa39041`; report if not).
- `bun test` has a pre-existing failure before you start.

## Maintenance notes

- If a future ticker symbol legitimately contains a character outside
  `[A-Za-z0-9._-]` (some Yahoo symbols use `^` or `=`), widen `isSafeAssetKey`
  accordingly — but never to allow `/`, `.` `.` traversal sequences, `?`, or `#`.
  The shared store already uses symbols like `$ETH.X` and `BRK.B`-style dots, so
  `.` is intentionally allowed; verify any new symbol charset against
  `data/prices/` filenames.
- The chart cache cap is a simple FIFO eviction, not LRU. If hit-rate matters
  later, switch to LRU; FIFO is sufficient for a 5-minute TTL cache.
- The Plan 3b CDN-purge wiring (`revalidate.ts` `purge()`) is unrelated and still
  a no-op; this plan only hardens the token compare, not the purge itself.
