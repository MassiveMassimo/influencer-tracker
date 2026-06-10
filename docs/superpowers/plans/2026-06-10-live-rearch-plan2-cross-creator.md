# Plan 2 — Cross-Creator Features (DB-First) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch the cross-creator features (all-calls explorer with client-side filter/sort/search, cross-creator ticker view) on top of a single precomputed **slim calls-index** artifact — materialized at ingest, served cheap — following the spec's "materialize at ingest, serve cheap" principle and Plan 1's `USE_DB` + static-fallback serve pattern.

**Architecture:** A pure `buildCallsIndex(datasets)` flattens every creator's scored calls into a slim, sortable projection (`CallIndexEntry[]` — no `quote`/`spark`/full `returns` map, so the whole corpus is one cached asset). It is materialized two ways, mirroring Plan 1: a `scripts/materialize.ts` writes it to a new `artifacts` DB table (the DB-first source, refreshed by ingest in Plan 3), and `prebuild.ts` writes `public/calls-index.json` (the static/CDN fallback). `fetchCallsIndex()` in `data.ts` serves from the DB under `USE_DB=1` and from the static asset otherwise — same window-guarded, dynamic-import, fallback-on-error shape as `fetchDataset()`. Two new routes consume the index entirely client-side: `/explore` (filter/sort/search over all calls) and `/t/$symbol` (one ticker across all creators). Filter and ticker-summary logic live in a pure, unit-tested `call-filter.ts` so the routes stay thin.

**Tech Stack:** drizzle-orm + `@neondatabase/serverless` (neon-http), Neon Postgres, zod v4, TanStack Router/Start, `bun test`. `#/` → `src/`. Builds directly on Plan 1 (`db/schema.ts`, `db/client.ts`, `src/lib/db-read.ts`, `src/lib/data.ts`).

**Scope boundary (YAGNI):**
- **No new chart.** `/t/$symbol` aggregates *who* called a ticker and *how accurate* they were, and links to each creator's existing per-creator chart page (`/c/$handle/ticker/$symbol`). A merged multi-creator price chart is deferred — the cross-creator value is the aggregation, the chart already exists per-creator.
- **No leaderboard rewrite.** The home page (`src/routes/index.tsx`) already ranks creators from `index.json`; it is unchanged. "Creator search" is covered by the explorer's creator filter + the existing roster list, not a separate search route.
- **No ingest wiring.** `db:materialize` is run manually in this plan; Plan 3 wires it into the ingest run. `review_queue` / `reject_audit` / cache invalidation / monitoring stay in Plans 3–4.
- **No server-side faceted query path.** Filter/sort/search are client-side over the slim index (spec: deferred until the ~50k-row crossover).

**Prerequisites (already satisfied by Plan 1):** Neon DB provisioned, `DATABASE_URL` in `.env`, schema migrated, backfilled (893 calls), `bun run scripts/parity-check.ts` prints `PARITY OK`. Confirm `echo $DATABASE_URL` resolves before Task 5.

**Carried-over Plan 1 review findings:** A Fable review of Plan 1 found three `USE_DB=1`-cutover blockers. Finding 2 (client-bundle guard) is fixed here in Task 0 because Plan 2 extends the same serve path and Task 11's bundle-safety gate depends on it. Findings 1 (empty-DB fallback in `listCreators`) and 3 (serve/ingest role separation) are NOT in this plan's scope — they are pre-cutover fixes on the Plan 1 code path, tracked separately. One consequence for Plan 2: when finding 3's read-only `serve` role lands, it must be granted `SELECT` on the new `artifacts` table (noted in Task 1).

---

### Task 0: Make the client-bundle guard statically eliminable (Plan 1 review finding 2)

**Files:**
- Modify: `src/lib/data.ts`

The Fable review proved (by building + grepping the client output) that neon/drizzle currently ship as lazy client chunks (~225 KB of dead, unreachable weight) because `typeof window === "undefined"` is a runtime check Rollup cannot eliminate. Plan 2's new `fetchCallsIndex` reuses the same `serverUseDb()` guard, so fix it once here — this also makes Task 11's "no neon in client bundle" gate actually pass.

- [ ] **Step 1: Change `serverUseDb` in `src/lib/data.ts`**

Replace the existing `const serverUseDb = () => typeof window === "undefined" && process.env.USE_DB === "1";` with:
```ts
// import.meta.env.SSR is statically replaced with `false` in the client build, so Rollup
// dead-code-eliminates the DB branch and never emits the neon/drizzle chunks at all. The
// window guard stays as belt-and-braces. (Plan 1 review finding: the runtime-only window
// check left neon as dead-but-present ~225 KB client chunks.)
const serverUseDb = () => import.meta.env.SSR && typeof window === "undefined" && process.env.USE_DB === "1";
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data.ts
git commit -m "fix(data): statically eliminable DB guard so neon stays out of client bundle (Plan 1 review)"
```

---

### Task 1: Add the `artifacts` table to the schema

**Files:**
- Modify: `db/schema.ts`
- Create (generated): `db/migrations/0001_*.sql`

- [ ] **Step 1: Add the table to `db/schema.ts`**

Append after the existing `prices` table (keep the `pgTable` import line as-is — `text`, `jsonb` are already imported):

```ts
// Materialized serve artifacts (Plan 2+). One row per artifact key; `payload` is the
// precomputed JSON served to the client. Recomputed at ingest in Plan 3; for now via
// `bun run db:materialize`. Kept generic so a leaderboard / other aggregates can be
// added as new keys without a schema change.
export const artifacts = pgTable("artifacts", {
  key: text("key").primaryKey(), // e.g. "calls-index"
  payload: jsonb("payload").notNull(),
  generatedAt: text("generated_at").notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new `db/migrations/0001_*.sql` with `CREATE TABLE "artifacts" (...)` and an updated `db/migrations/meta/` snapshot. It must NOT touch `creators`/`calls`/`prices`.

- [ ] **Step 3: Apply the migration**

Run: `bun run db:migrate`
Expected: `[✓] migrations applied successfully` (or "No migrations to apply" if already run). Verify: `bun run -e 'import {getDb} from "./db/client"; import {sql} from "drizzle-orm"; const r = await getDb().execute(sql\`select to_regclass(\'public.artifacts\') as t\`); console.log(r.rows ?? r);'` prints a non-null `artifacts`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(db): add artifacts table for materialized serve payloads"
```

> **Cross-plan note (Plan 1 review finding 3):** when the read-only `serve` role is introduced (pre-cutover, Plan 1 scope), it must get `GRANT SELECT ON artifacts`, and the writer role (`ingest`/owner) `GRANT SELECT, INSERT, UPDATE ON artifacts` (materialize upserts). `scripts/apply-roles.ts` grants per-named-table, so it needs a re-run after this migration. Not actionable inside Plan 2 (the role split isn't built yet); flagged so it isn't missed.

---

### Task 2: `buildCallsIndex` — the slim cross-creator projection

**Files:**
- Create: `src/lib/call-index.ts`
- Test: `src/lib/call-index.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/call-index.test.ts`:

```ts
import { test, expect } from "bun:test";
import { buildCallsIndex, CallIndexSchema } from "./call-index";
import type { Dataset, Call } from "./types";

function call(over: Partial<Call> & { shortcode: string; ticker: string; postDate: string }): Call {
  return {
    company: "Acme", isFirstCall: true, conviction: 0.5, quote: "buy it",
    summary: "thesis", onScreenPrice: null, spark: [1, 2, 3],
    returns: {
      "1w": { stock: null, spy: null, excess: null },
      "1m": { stock: null, spy: null, excess: null },
      "3m": { stock: 0.1, spy: 0.04, excess: 0.06 },
      toDate: { stock: 0.2, spy: 0.05, excess: 0.15 },
    },
    ...over,
  };
}
function ds(handle: string, calls: Call[]): Dataset {
  return {
    creator: { handle, name: handle.toUpperCase() }, generatedAt: "2026-06-01",
    spyAnchor: "SPY", calls,
    scorecard: { totalCalls: calls.length, uniqueTickers: 1, hitRate: { "1m": 0, "3m": 0 },
      hitRateN: { "1m": 0, "3m": 0 }, avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
      callsPerWeek: 0, best: [], worst: [] },
    caveats: [],
  };
}

test("flattens every creator's calls into the slim shape, dropping heavy fields", () => {
  const out = buildCallsIndex([
    ds("alice", [call({ shortcode: "a1", ticker: "NVDA", postDate: "2026-05-01" })]),
    ds("bob", [call({ shortcode: "b1", ticker: "AMD", postDate: "2026-05-02" })]),
  ]);
  expect(out).toHaveLength(2);
  const e = out.find((r) => r.shortcode === "a1")!;
  expect(e.handle).toBe("alice");
  expect(e.ticker).toBe("NVDA");
  expect(e.ex3m).toBe(0.06);
  expect(e.exToDate).toBe(0.15);
  expect(e.stockToDate).toBe(0.2);
  // heavy fields must NOT leak into the slim index
  expect(e).not.toHaveProperty("quote");
  expect(e).not.toHaveProperty("spark");
  expect(e).not.toHaveProperty("returns");
});

test("orders by postDate desc, then handle, then shortcode (deterministic)", () => {
  const out = buildCallsIndex([
    ds("bob", [call({ shortcode: "b1", ticker: "AMD", postDate: "2026-05-01" })]),
    ds("alice", [
      call({ shortcode: "a2", ticker: "NVDA", postDate: "2026-05-01" }),
      call({ shortcode: "a1", ticker: "NVDA", postDate: "2026-05-05" }),
    ]),
  ]);
  expect(out.map((r) => r.shortcode)).toEqual(["a1", "a2", "b1"]);
});

test("output validates against CallIndexSchema", () => {
  const out = buildCallsIndex([ds("alice", [call({ shortcode: "a1", ticker: "NVDA", postDate: "2026-05-01" })])]);
  expect(() => CallIndexSchema.parse(out)).not.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/call-index.test.ts`
Expected: FAIL — `Cannot find module './call-index'`.

- [ ] **Step 3: Implement `src/lib/call-index.ts`**

```ts
import { z } from "zod";
import type { Dataset } from "./types";

// Slim, cross-creator projection of a scored call. Excludes heavy fields (quote, spark,
// full returns map) so the entire corpus ships as one cached asset for client-side
// filter/sort/search. `ex*` / `stockToDate` are the sortable/filterable scoring metrics;
// join creator name/avatar from the roster (index.json) client-side.
export interface CallIndexEntry {
  handle: string;
  shortcode: string;
  ticker: string;
  company: string;
  postDate: string;
  isFirstCall: boolean;
  conviction: number;
  ex3m: number | null; // returns["3m"].excess
  exToDate: number | null; // returns.toDate.excess
  stockToDate: number | null; // returns.toDate.stock
  summary?: string;
}

export const CallIndexEntrySchema = z.object({
  handle: z.string(),
  shortcode: z.string(),
  ticker: z.string(),
  company: z.string(),
  postDate: z.string(),
  isFirstCall: z.boolean(),
  conviction: z.number(),
  ex3m: z.number().nullable(),
  exToDate: z.number().nullable(),
  stockToDate: z.number().nullable(),
  summary: z.string().optional(),
});
export const CallIndexSchema = z.array(CallIndexEntrySchema);

// Flatten all creators' scored calls into the slim cross-creator index. Sort is
// deterministic (postDate desc, handle asc, shortcode asc) so the artifact is stable
// across rebuilds — a stable payload keeps cache busting meaningful in Plan 3.
export function buildCallsIndex(datasets: Dataset[]): CallIndexEntry[] {
  const rows: CallIndexEntry[] = [];
  for (const d of datasets) {
    const handle = d.creator.handle;
    for (const c of d.calls) {
      rows.push({
        handle,
        shortcode: c.shortcode,
        ticker: c.ticker,
        company: c.company,
        postDate: c.postDate,
        isFirstCall: c.isFirstCall,
        conviction: c.conviction,
        ex3m: c.returns["3m"].excess,
        exToDate: c.returns.toDate.excess,
        stockToDate: c.returns.toDate.stock,
        ...(c.summary != null ? { summary: c.summary } : {}),
      });
    }
  }
  rows.sort(
    (a, b) =>
      b.postDate.localeCompare(a.postDate) ||
      a.handle.localeCompare(b.handle) ||
      a.shortcode.localeCompare(b.shortcode),
  );
  return rows;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/lib/call-index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/call-index.ts src/lib/call-index.test.ts
git commit -m "feat(call-index): slim cross-creator call projection"
```

---

### Task 3: `readCallsIndex` — read the artifact from the DB

**Files:**
- Modify: `src/lib/db-read.ts`
- Test: `src/lib/db-read.test.ts:1-50` (extend the existing env-gated golden-master suite)

- [ ] **Step 1: Add the failing test**

Append a new `test(...)` inside the existing `describe.skipIf(!RUN)("DB read golden master", ...)` block in `src/lib/db-read.test.ts` (after the `readPrices` test, before the closing `});`). Also import the materialize helpers at the top.

Add to the imports at the top of the file:
```ts
import { buildCallsIndex } from "./call-index";
import { artifacts } from "../../db/schema";
import { readCallsIndex } from "./db-read";
```

Add this test inside the `describe` block:
```ts
  test("readCallsIndex deep-equals buildCallsIndex over all datasets", async () => {
    const datasets = await Promise.all(index.map((e: { handle: string }) => readDataset(db, e.handle)));
    const expected = buildCallsIndex(datasets);
    await db.insert(artifacts)
      .values({ key: "calls-index", payload: expected, generatedAt: "2026-06-10" })
      .onConflictDoUpdate({ target: artifacts.key, set: { payload: expected, generatedAt: "2026-06-10" } });
    const fromDb = await readCallsIndex(db);
    expect(fromDb).toEqual(expected);
  });
```
(The `beforeAll` already backfills `creators`/`calls`; add `artifacts` to its `TRUNCATE` list: change `TRUNCATE creators, calls, prices` to `TRUNCATE creators, calls, prices, artifacts`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL_TEST="$DATABASE_URL_TEST" bun test src/lib/db-read.test.ts` (skips with no test branch — see note below).
Expected (with a test branch set): FAIL — `readCallsIndex` is not exported. Without `DATABASE_URL_TEST`: the suite **skips**; rely on the manual DB check in Task 6 instead. This matches Plan 1's env-gated test convention.

- [ ] **Step 3: Implement in `src/lib/db-read.ts`**

Add `artifacts` to the schema import and a new export:
```ts
// change the existing import line:
import { creators, calls, prices, artifacts } from "../../db/schema";
// add near the other imports:
import { CallIndexSchema, type CallIndexEntry } from "./call-index";
```
Append the function:
```ts
export async function readCallsIndex(db: Db): Promise<CallIndexEntry[]> {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.key, "calls-index"));
  if (!row) throw new Error("calls-index artifact missing — run `bun run db:materialize`");
  return CallIndexSchema.parse(row.payload);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/lib/db-read.test.ts`
Expected: PASS if a test branch is set, otherwise SKIP (0 fail either way). Also run `bunx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db-read.ts src/lib/db-read.test.ts
git commit -m "feat(db-read): readCallsIndex from the artifacts table"
```

---

### Task 4: `fetchCallsIndex` — serve with the `USE_DB` + static fallback

**Files:**
- Modify: `src/lib/data.ts`

This mirrors `fetchDataset()` exactly: window-guarded DB read under `USE_DB=1`, dynamic import so neon never enters the client bundle, static asset otherwise, fallback-to-static on any DB error.

- [ ] **Step 1: Add to `src/lib/data.ts`**

Add the import near the top (next to the other `./` imports):
```ts
import { CallIndexSchema, type CallIndexEntry } from "./call-index";
```
Append after `fetchPrices`:
```ts
// Slim cross-creator calls index (Plan 2). One cached asset for the /explore and
// /t/$symbol routes; all filter/sort/search is client-side over it. DB-first under
// USE_DB (the artifacts table, refreshed by ingest in Plan 3); static asset otherwise.
export async function fetchCallsIndex(): Promise<CallIndexEntry[]> {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readCallsIndex } = await import("./db-read");
      return await readCallsIndex(getDb());
    } catch (e) {
      console.error("fetchCallsIndex DB fallback", e);
    }
  }
  const path = "/calls-index.json";
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`calls-index: ${res.status}`);
  return CallIndexSchema.parse(await res.json());
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors. (No unit test here — `data.ts` imports `dataset-source.ts` which uses Vite-only `import.meta.glob`, so it is not `bun test`-able; verification is tsc + the build's client-bundle gate + Task 6's manual run, exactly as in Plan 1.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat(data): fetchCallsIndex serve path (DB-first + static fallback)"
```

---

### Task 5: `scripts/materialize.ts` — write the artifact from the DB ledger

**Files:**
- Create: `scripts/materialize.ts`
- Modify: `package.json` (add `db:materialize` script)

- [ ] **Step 1: Create `scripts/materialize.ts`**

```ts
// Recompute serve artifacts from the DB ledger and upsert them into the `artifacts`
// table. Run after backfill/score (and, in Plan 3, at the end of each ingest run).
// Idempotent: upserts by key. Requires DATABASE_URL.
import { getDb } from "../db/client";
import { readIndex, readDataset } from "../src/lib/db-read";
import { buildCallsIndex } from "../src/lib/call-index";
import { artifacts } from "../db/schema";

async function main() {
  const db = getDb();
  const index = await readIndex(db);
  const datasets = await Promise.all(index.map((e) => readDataset(db, e.handle)));
  const callsIndex = buildCallsIndex(datasets);
  const generatedAt = new Date().toISOString().slice(0, 10);
  await db
    .insert(artifacts)
    .values({ key: "calls-index", payload: callsIndex, generatedAt })
    .onConflictDoUpdate({ target: artifacts.key, set: { payload: callsIndex, generatedAt } });
  console.log(`materialized calls-index: ${callsIndex.length} calls across ${index.length} creators`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Add the script to `package.json`**

In the `"scripts"` block, after `"db:roles"`:
```json
    "db:materialize": "bun run scripts/materialize.ts",
```

- [ ] **Step 3: Run it against the real DB**

Run: `bun run db:materialize`
Expected: `materialized calls-index: 893 calls across 2 creators` (counts match the current backfill).

- [ ] **Step 4: Commit**

```bash
git add scripts/materialize.ts package.json
git commit -m "feat(db): db:materialize writes the slim calls-index artifact"
```

---

### Task 6: Static `calls-index.json` in prebuild + end-to-end serve check

**Files:**
- Modify: `scripts/prebuild.ts`

The static asset is the `USE_DB=0` / panic-fallback source, written at build time like `public/datasets/*.json`.

- [ ] **Step 1: Add to `scripts/prebuild.ts`**

Add the import at the top (next to the `renderOgPng` import):
```ts
import { buildCallsIndex } from "../src/lib/call-index";
import type { Dataset } from "../src/lib/types";
```
In `main()`, the per-creator loop (the one that does `cpSync(... dataset.json ...)`) already reads each `ds`. Collect them: declare `const datasets: Dataset[] = [];` just before that loop, push each `ds` (`datasets.push(ds as Dataset);`) inside it, then after the loop and before the `llms.txt` write add:
```ts
  writeFileSync(join(PUB, "calls-index.json"), JSON.stringify(buildCallsIndex(datasets)));
```
Update the final `console.log` to mention it (append `+ calls-index` to the message).

- [ ] **Step 2: Run prebuild and verify the static asset**

Run: `bun run scripts/prebuild.ts`
Expected: completes; `public/calls-index.json` exists. Verify shape + count:
`bun run -e 'const a = await Bun.file("public/calls-index.json").json(); console.log(a.length, a[0]);'`
Expected: `893` and a slim entry with `handle`/`ticker`/`ex3m` and NO `quote`/`spark`/`returns`.

- [ ] **Step 3: Cross-check DB vs static parity**

Run:
```bash
bun run -e 'import {getDb} from "./db/client"; import {readCallsIndex} from "./src/lib/db-read"; const db=await readCallsIndex(getDb()); const stat=await Bun.file("public/calls-index.json").json(); console.log("db",db.length,"static",stat.length,"equal",JSON.stringify(db)===JSON.stringify(stat));'
```
Expected: `db 893 static 893 equal true` (both come from `buildCallsIndex` over the same data; if `false`, the DB is stale — re-run `db:materialize`).

- [ ] **Step 4: Commit**

```bash
git add scripts/prebuild.ts
git commit -m "feat(prebuild): emit static public/calls-index.json fallback asset"
```

---

### Task 7: `call-filter.ts` — explorer filter/sort + ticker summary (pure, tested)

**Files:**
- Create: `src/lib/call-filter.ts`
- Test: `src/lib/call-filter.test.ts`

Extracting the logic keeps the route components thin and gives the filter/sort/search and ticker-aggregation actual unit coverage.

- [ ] **Step 1: Write the failing test**

`src/lib/call-filter.test.ts`:

```ts
import { test, expect } from "bun:test";
import { applyCallFilter, summarizeTicker, type CallFilter } from "./call-filter";
import type { CallIndexEntry } from "./call-index";

const NAMES: Record<string, string> = { alice: "Alice Smith", bob: "Bob Jones" };
function e(over: Partial<CallIndexEntry> & { shortcode: string }): CallIndexEntry {
  return {
    handle: "alice", ticker: "NVDA", company: "Nvidia", postDate: "2026-05-01",
    isFirstCall: true, conviction: 0.5, ex3m: 0.05, exToDate: 0.1, stockToDate: 0.2,
    summary: "ai chips", ...over,
  };
}
const ROWS: CallIndexEntry[] = [
  e({ shortcode: "1", handle: "alice", ticker: "NVDA", postDate: "2026-05-03", ex3m: 0.2, exToDate: 0.3 }),
  e({ shortcode: "2", handle: "bob", ticker: "AMD", company: "AMD", summary: "cpus", postDate: "2026-05-01", ex3m: -0.1, exToDate: -0.05, isFirstCall: false }),
  e({ shortcode: "3", handle: "alice", ticker: "AMD", company: "AMD", postDate: "2026-05-02", ex3m: 0.0, exToDate: 0.0 }),
];
const BASE: CallFilter = { search: "", handles: [], firstOnly: false, beatSpyOnly: false, horizon: "ex3m", sort: { key: "postDate", dir: -1 } };

test("default: all rows, sorted by postDate desc", () => {
  expect(applyCallFilter(ROWS, BASE, NAMES).map((r) => r.shortcode)).toEqual(["1", "3", "2"]);
});
test("creator filter narrows to selected handles", () => {
  expect(applyCallFilter(ROWS, { ...BASE, handles: ["bob"] }, NAMES).map((r) => r.shortcode)).toEqual(["2"]);
});
test("firstOnly drops non-first calls", () => {
  expect(applyCallFilter(ROWS, { ...BASE, firstOnly: true }, NAMES).map((r) => r.shortcode)).toEqual(["1", "3"]);
});
test("beatSpyOnly keeps rows with positive excess at the chosen horizon", () => {
  expect(applyCallFilter(ROWS, { ...BASE, beatSpyOnly: true, horizon: "ex3m" }, NAMES).map((r) => r.shortcode)).toEqual(["1"]);
});
test("search matches ticker, company, summary, and creator name (case-insensitive)", () => {
  expect(applyCallFilter(ROWS, { ...BASE, search: "amd" }, NAMES).map((r) => r.shortcode).sort()).toEqual(["2", "3"]);
  expect(applyCallFilter(ROWS, { ...BASE, search: "bob jones" }, NAMES).map((r) => r.shortcode)).toEqual(["2"]);
  expect(applyCallFilter(ROWS, { ...BASE, search: "cpus" }, NAMES).map((r) => r.shortcode)).toEqual(["2"]);
});
test("sort by ex3m desc puts best first; nulls sort last", () => {
  const rows = [...ROWS, e({ shortcode: "4", ex3m: null })];
  expect(applyCallFilter(rows, { ...BASE, sort: { key: "ex3m", dir: -1 } }, NAMES).map((r) => r.shortcode)).toEqual(["1", "3", "2", "4"]);
});
test("summarizeTicker aggregates one ticker across creators", () => {
  const s = summarizeTicker(ROWS, "AMD");
  expect(s.symbol).toBe("AMD");
  expect(s.company).toBe("AMD");
  expect(s.callCount).toBe(2);
  expect(s.creatorCount).toBe(2);
  expect(s.byCreator.map((b) => b.handle).sort()).toEqual(["alice", "bob"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/call-filter.test.ts`
Expected: FAIL — `Cannot find module './call-filter'`.

- [ ] **Step 3: Implement `src/lib/call-filter.ts`**

```ts
import type { CallIndexEntry } from "./call-index";

export type HorizonKey = "ex3m" | "exToDate";
export type SortKey = "postDate" | "conviction" | "ex3m" | "exToDate";

export interface CallFilter {
  search: string;
  handles: string[]; // empty = all creators
  firstOnly: boolean;
  beatSpyOnly: boolean;
  horizon: HorizonKey; // which excess column "beatSpyOnly" uses
  sort: { key: SortKey; dir: 1 | -1 };
}

// Nulls always sort last regardless of direction (a missing metric is not "worst").
function cmpNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

export function applyCallFilter(
  rows: CallIndexEntry[],
  f: CallFilter,
  names: Record<string, string>,
): CallIndexEntry[] {
  const q = f.search.trim().toLowerCase();
  const handleSet = f.handles.length ? new Set(f.handles) : null;
  const filtered = rows.filter((r) => {
    if (handleSet && !handleSet.has(r.handle)) return false;
    if (f.firstOnly && !r.isFirstCall) return false;
    if (f.beatSpyOnly) {
      const ex = r[f.horizon];
      if (ex == null || ex <= 0) return false;
    }
    if (q) {
      const hay = `${r.ticker} ${r.company} ${r.summary ?? ""} ${names[r.handle] ?? ""} ${r.handle}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { key, dir } = f.sort;
  return filtered.sort((a, b) => {
    if (key === "postDate") return a.postDate.localeCompare(b.postDate) * dir || a.shortcode.localeCompare(b.shortcode);
    if (key === "conviction") return (a.conviction - b.conviction) * dir || a.shortcode.localeCompare(b.shortcode);
    return cmpNullable(a[key], b[key], dir) || a.shortcode.localeCompare(b.shortcode);
  });
}

export interface TickerCreatorRow {
  handle: string;
  callCount: number;
  firstCallDate: string | null; // earliest first-call postDate for this ticker
  bestEx3m: number | null;
  ex3m: number | null; // first-call ex3m (the representative call)
  exToDate: number | null;
}
export interface TickerSummary {
  symbol: string;
  company: string;
  callCount: number;
  creatorCount: number;
  avgEx3m: number | null;
  avgExToDate: number | null;
  byCreator: TickerCreatorRow[];
}

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Aggregate one ticker across all creators who called it. Drives /t/$symbol.
export function summarizeTicker(rows: CallIndexEntry[], symbol: string): TickerSummary {
  const sym = symbol.toUpperCase();
  const hits = rows.filter((r) => r.ticker.toUpperCase() === sym);
  const byHandle = new Map<string, CallIndexEntry[]>();
  for (const r of hits) {
    const arr = byHandle.get(r.handle) ?? [];
    arr.push(r);
    byHandle.set(r.handle, arr);
  }
  const byCreator: TickerCreatorRow[] = [...byHandle.entries()].map(([handle, cs]) => {
    const first = cs.find((c) => c.isFirstCall) ?? [...cs].sort((a, b) => a.postDate.localeCompare(b.postDate))[0];
    return {
      handle,
      callCount: cs.length,
      firstCallDate: first?.postDate ?? null,
      bestEx3m: cs.reduce<number | null>((m, c) => (c.ex3m != null && (m == null || c.ex3m > m) ? c.ex3m : m), null),
      ex3m: first?.ex3m ?? null,
      exToDate: first?.exToDate ?? null,
    };
  });
  byCreator.sort((a, b) => cmpNullable(a.ex3m, b.ex3m, -1) || a.handle.localeCompare(b.handle));
  return {
    symbol: sym,
    company: hits[0]?.company ?? sym,
    callCount: hits.length,
    creatorCount: byHandle.size,
    avgEx3m: avg(byCreator.map((b) => b.ex3m)),
    avgExToDate: avg(byCreator.map((b) => b.exToDate)),
    byCreator,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test src/lib/call-filter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/call-filter.ts src/lib/call-filter.test.ts
git commit -m "feat(call-filter): explorer filter/sort + cross-creator ticker summary"
```

---

### Task 8: `/explore` — all-calls explorer route

**Files:**
- Create: `src/routes/explore.tsx`

Loads the slim index + roster, filters/sorts/searches entirely client-side. Reuse the formatting helpers' style from `src/routes/index.tsx` (`pct`/`signed`) and the lina `ScrollArea` for the table (per the project scroll-area convention). No DB at request time beyond the one cached `fetchCallsIndex()`.

- [ ] **Step 1: Create `src/routes/explore.tsx`**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { fetchCallsIndex, listCreators } from "../lib/data";
import { applyCallFilter, type CallFilter, type SortKey } from "../lib/call-filter";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/explore")({
  loader: async () => {
    const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
    return { calls, creators };
  },
  head: () => ({
    meta: [
      { title: "Explore all calls — Signal Tracker" },
      { name: "description", content: "Filter, sort, and search every scored stock call across all tracked creators." },
      { property: "og:url", content: siteUrl("/explore") },
      { property: "og:image", content: siteUrl("/og.png") },
    ],
  }),
  component: Explore,
});

function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
function tone(x: number | null) {
  return x == null ? "text-muted-foreground" : x > 0 ? "text-emerald-600 dark:text-emerald-400" : x < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
}

function Explore() {
  const { calls, creators } = Route.useLoaderData();
  const names = useMemo(() => Object.fromEntries(creators.map((c) => [c.handle, c.name])), [creators]);
  const [filter, setFilter] = useState<CallFilter>({
    search: "", handles: [], firstOnly: false, beatSpyOnly: false, horizon: "ex3m", sort: { key: "postDate", dir: -1 },
  });
  const rows = useMemo(() => applyCallFilter(calls, filter, names), [calls, filter, names]);
  const onSort = (key: SortKey) =>
    setFilter((f) => ({ ...f, sort: f.sort.key === key ? { key, dir: (f.sort.dir * -1) as 1 | -1 } : { key, dir: -1 } }));
  const toggleHandle = (h: string) =>
    setFilter((f) => ({ ...f, handles: f.handles.includes(h) ? f.handles.filter((x) => x !== h) : [...f.handles, h] }));

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">All calls · vs SPY</div>
        <h1 className="mt-1 font-heading text-2xl">Explore calls</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every scored call across all creators. Filter, sort, and search — all client-side over one cached index ({calls.length} calls).
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search ticker, company, creator…"
          className="h-9 w-full max-w-xs rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus:border-foreground/30 md:w-64"
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={filter.firstOnly} onChange={(e) => setFilter((f) => ({ ...f, firstOnly: e.target.checked }))} />
          First calls only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={filter.beatSpyOnly} onChange={(e) => setFilter((f) => ({ ...f, beatSpyOnly: e.target.checked }))} />
          Beat SPY (3m)
        </label>
      </div>

      {creators.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {creators.map((c) => {
            const on = filter.handles.includes(c.handle);
            return (
              <button
                key={c.handle}
                type="button"
                onClick={() => toggleHandle(c.handle)}
                className={`rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${on ? "border-foreground/30 bg-foreground/[0.08] text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
              >
                @{c.handle}
              </button>
            );
          })}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] md:grid-cols-[1fr_8rem_6rem_6rem_6rem] md:gap-3 md:px-5">
          <span>Call</span>
          <button type="button" className="hidden text-right hover:text-foreground md:block" onClick={() => onSort("postDate")}>Date</button>
          <button type="button" className="text-right hover:text-foreground" onClick={() => onSort("conviction")}>Conv</button>
          <button type="button" className="text-right hover:text-foreground" onClick={() => onSort("ex3m")}>Excess 3m</button>
          <button type="button" className="hidden text-right hover:text-foreground md:block" onClick={() => onSort("exToDate")}>Excess→now</button>
        </div>
        <ul className="divide-y divide-border/40">
          {rows.length === 0 ? (
            <li className="px-5 py-6 text-sm text-muted-foreground">No calls match.</li>
          ) : (
            rows.slice(0, 500).map((r) => (
              <li key={`${r.handle}:${r.shortcode}`}>
                <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-3 md:grid-cols-[1fr_8rem_6rem_6rem_6rem] md:gap-3 md:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link to="/t/$symbol" params={{ symbol: r.ticker }} className="font-medium text-sm text-foreground no-underline hover:underline">{r.ticker}</Link>
                      <Link to="/c/$handle" params={{ handle: r.handle }} className="truncate font-mono text-xs text-muted-foreground no-underline hover:text-foreground">@{r.handle}</Link>
                    </div>
                    {r.summary && <div className="truncate text-xs text-muted-foreground">{r.summary}</div>}
                  </div>
                  <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">{r.postDate.slice(5)}</div>
                  <div className="text-right font-mono text-xs text-muted-foreground tabular-nums">{(r.conviction * 100).toFixed(0)}</div>
                  <div className={`text-right font-mono text-sm tabular-nums ${tone(r.ex3m)}`}>{signed(r.ex3m)}</div>
                  <div className={`hidden text-right font-mono text-sm tabular-nums md:block ${tone(r.exToDate)}`}>{signed(r.exToDate)}</div>
                </div>
              </li>
            ))
          )}
        </ul>
        {rows.length > 500 && (
          <div className="border-t border-border/40 px-5 py-3 text-center text-xs text-muted-foreground">
            Showing first 500 of {rows.length}. Narrow the filter to see more.
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + route-tree regen**

Run: `bunx tsc --noEmit`
Expected: 0 errors. (TanStack Start regenerates `routeTree.gen.ts` on `bun run dev`/`build`; if tsc complains the `/explore` or `/t/$symbol` route isn't in the tree yet, run `bun run build` once to regenerate it, then re-run tsc. Do not hand-edit `routeTree.gen.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/explore.tsx
git commit -m "feat(explore): all-calls explorer with client filter/sort/search"
```

---

### Task 9: `/t/$symbol` — cross-creator ticker view

**Files:**
- Create: `src/routes/t.$symbol.tsx`

Aggregates one ticker across every creator who called it, ranked by 3-month excess, each row linking to that creator's existing per-creator chart page.

- [ ] **Step 1: Create `src/routes/t.$symbol.tsx`**

```tsx
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { fetchCallsIndex, listCreators } from "../lib/data";
import { summarizeTicker } from "../lib/call-filter";
import { siteUrl } from "#/og/site.ts";

export const Route = createFileRoute("/t/$symbol")({
  loader: async ({ params }) => {
    const [calls, creators] = await Promise.all([fetchCallsIndex(), listCreators()]);
    const summary = summarizeTicker(calls, params.symbol);
    if (summary.callCount === 0) throw notFound();
    const names = Object.fromEntries(creators.map((c) => [c.handle, c.name] as const));
    const avatars = Object.fromEntries(creators.map((c) => [c.handle, c.avatar] as const));
    return { summary, names, avatars };
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.symbol.toUpperCase()} — who called it · Signal Tracker` },
      { name: "description", content: `Every tracked creator who called ${params.symbol.toUpperCase()}, ranked by forward return vs SPY.` },
      { property: "og:url", content: siteUrl(`/t/${params.symbol.toUpperCase()}`) },
      { property: "og:image", content: siteUrl("/og.png") },
    ],
  }),
  component: TickerView,
});

function signed(x: number | null) {
  return x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}
function tone(x: number | null) {
  return x == null ? "text-muted-foreground" : x > 0 ? "text-emerald-600 dark:text-emerald-400" : x < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground";
}

function TickerView() {
  const { summary, names, avatars } = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 md:px-10 md:py-10">
      <header>
        <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.3em]">Cross-creator · vs SPY</div>
        <h1 className="mt-1 font-heading text-2xl">{summary.symbol}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{summary.company}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Creators" value={String(summary.creatorCount)} />
          <Stat label="Calls" value={String(summary.callCount)} />
          <Stat label="Avg excess 3m" value={signed(summary.avgEx3m)} toneClass={tone(summary.avgEx3m)} />
          <Stat label="Avg excess→now" value={signed(summary.avgExToDate)} toneClass={tone(summary.avgExToDate)} />
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-background">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 border-b border-border/40 px-4 py-3 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.08em] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5">
          <span>Creator</span>
          <span className="hidden text-right md:block">First call</span>
          <span className="text-right">Excess 3m</span>
          <span className="text-right">Excess→now</span>
        </div>
        <ul className="divide-y divide-border/40">
          {summary.byCreator.map((b) => (
            <li key={b.handle}>
              <Link
                to="/c/$handle/ticker/$symbol"
                params={{ handle: b.handle, symbol: summary.symbol }}
                className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2 px-4 py-4 no-underline transition-colors hover:bg-foreground/[0.03] md:grid-cols-[1fr_7rem_6rem_6rem] md:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {avatars[b.handle] ? (
                    <img src={avatars[b.handle]} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-border/60" />
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-mono text-[10px] uppercase ring-1 ring-border/60">{b.handle.slice(0, 2)}</div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium text-sm text-foreground">{names[b.handle] ?? b.handle}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{b.callCount} call{b.callCount === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">{b.firstCallDate?.slice(0, 7) ?? "—"}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${tone(b.ex3m)}`}>{signed(b.ex3m)}</div>
                <div className={`text-right font-mono text-sm tabular-nums ${tone(b.exToDate)}`}>{signed(b.exToDate)}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value, toneClass = "text-foreground" }: { label: string; value: string; toneClass?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-foreground/[0.02] px-3 py-2.5">
      <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.2em]">{label}</div>
      <div className={`mt-0.5 font-mono text-lg tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run build` (regenerates the route tree to include `/t/$symbol`) then `bunx tsc --noEmit`.
Expected: build succeeds; tsc 0 errors. Confirm the `to="/c/$handle/ticker/$symbol"` link param names match the existing route file `src/routes/c.$handle.ticker.$symbol.tsx` (`handle`, `symbol`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/t.$symbol.tsx
git commit -m "feat(ticker): cross-creator /t/$symbol view"
```

---

### Task 10: Nav wiring — Explore link in the rail

**Files:**
- Modify: `src/components/WorkspaceRail.tsx`

Add an "Explore" item to the primary nav `<ul>` (the one currently holding only "Home"). `MobileNav` reuses `RailContent`, so it inherits this automatically. Do NOT touch `src/routes/__root.tsx` (it's being edited in parallel on `main` — avoid the conflict).

- [ ] **Step 1: Add the nav item**

In `src/components/WorkspaceRail.tsx`, change the icon import:
```ts
import { CompassIcon, HomeIcon, LineChartIcon, SettingsIcon, UsersIcon } from "lucide-react";
```
In the primary nav `<ul className="flex flex-col gap-0.5">` (the one with the Home `<li>`), add a second `<li>` after the Home one:
```tsx
          <li>
            <Link
              to="/explore"
              onClick={onNavigate}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
              activeProps={{
                className:
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-foreground/[0.06] text-foreground no-underline",
              }}
            >
              <CompassIcon className="size-4 opacity-70" />
              Explore calls
            </Link>
          </li>
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkspaceRail.tsx
git commit -m "feat(nav): Explore calls link in the workspace rail"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Test suite + typecheck**

Run: `bun test` then `bunx tsc --noEmit`
Expected: `bun test` — all prior tests + the new `call-index` (3) and `call-filter` (7) pass; db-read's new test passes or skips; 0 fail. tsc — 0 errors.

- [ ] **Step 2: Build with `USE_DB=0`, confirm static assets + client-bundle safety**

Run: `USE_DB=0 bun run build`
Expected: build succeeds; `public/calls-index.json` written by prebuild. Confirm neon/drizzle remain a server-only orphan chunk — grep the **client** output for neon:
`grep -rl "neondatabase" .output/public 2>/dev/null && echo "LEAK" || echo "clean (no neon in client bundle)"`
Expected: `clean (no neon in client bundle)`.

- [ ] **Step 3: Manual smoke (static path, USE_DB unset)**

Run: `bun run dev` (or `bun run preview` against the build). Visit:
- `/explore` — table renders, search/filter/sort all respond instantly, creator chips toggle, ticker links go to `/t/<sym>`.
- `/t/NVDA` (or any real ticker from the data) — stats header + per-creator rows; each row links to `/c/<handle>/ticker/NVDA`.
- `/t/ZZZZ` (non-existent) — 404, not a crash.
Stop the dev server when done.

- [ ] **Step 4: Manual smoke (DB path)**

Run: `USE_DB=1 bun run dev`. Confirm `/explore` and `/t/<sym>` still render identically (served from the `artifacts` table). Stop the server.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(plan2): verification fixups" || echo "nothing to commit"
```

---

## Self-Review

- **Spec coverage:** slim calls-index (one cached asset, client filter/sort/search) ✓ Tasks 2,4,6,8; leaderboard — pre-existing on home, unchanged (noted) ✓; cross-creator ticker view ✓ Task 9; creator search — covered by explorer creator filter ✓ Task 8; roster off `import.meta.glob` — already handled by Plan 1's `USE_DB` `listCreators` (noted) ✓; materialize-at-ingest ✓ Task 5 (manual now, ingest-wired in Plan 3); `USE_DB` + static fallback ✓ Task 4; YAGNI: no server faceted path, no new chart, no leaderboard rewrite ✓.
- **Type consistency:** `CallIndexEntry`/`CallFilter`/`SortKey`/`HorizonKey`/`TickerSummary` defined once and used consistently across `call-index.ts`, `call-filter.ts`, routes, `db-read.ts`, `data.ts`, `materialize.ts`. `buildCallsIndex(Dataset[])` signature matches all callers (prebuild collects `Dataset[]`, materialize maps `readDataset`). `artifacts` key `"calls-index"` consistent across write (materialize, db-read test) and read (db-read).
- **Placeholder scan:** every code step has complete code; route-tree regen and the env-gated db-read test are explicitly handled, not hand-waved.
- **Open spec decision resolved:** artifact storage = **DB `artifacts` JSONB row** (DB-first) + **static `public/calls-index.json`** (fallback), not Blob — Blob enters in Plan 3 with OG. Documented in the architecture header.
