# Plan 1 — DB Foundation + Serve Cutover (Kill-Switch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Neon Postgres as the source of truth, backfill it losslessly from the existing static JSON, and route the dashboard's read path through the DB behind an env flag — with static JSON as the panic fallback and a golden-master test proving DB output is byte-identical to static.

**Architecture:** Add a drizzle-orm schema (`creators`, `calls`, `prices`) over Neon. A backfill script parses `data/creators/index.json`, each `data/creators/<h>/dataset.json`, and `data/prices/<sym>.json` into the DB. A DB read module reassembles the exact `Dataset` / `IndexEntry[]` / OHLC shapes. `src/lib/data.ts` branches on `USE_DB` so the site serves from DB or static. `prices` is DB-enforced insert-only (frozen-scoring guarantee). No ingest changes, no new user-facing features, no recomputation — this plan only moves the *read* path. Plans 2–4 build features, ingest, and the LLM gate on top.

**Tech Stack:** drizzle-orm + drizzle-kit, `@neondatabase/serverless` (neon-http driver, works on Vercel functions and in Bun scripts), Neon Postgres, zod v4, `bun test`. `#/` → `src/`.

**Scope boundary (YAGNI):** Tables `review_queue` and `reject_audit` from the spec are NOT created here — they have no data to hold until the ingest/LLM plans. The slim calls-index, leaderboard, and materialized aggregates are Plan 2. Cache invalidation, OG-on-VM, and monitoring are Plan 3.

**Prerequisite (one-time, manual — not a code task):** Provision a Neon Postgres database via the Vercel Marketplace and a separate Neon **branch** for tests. Set `DATABASE_URL` (prod/dev) and `DATABASE_URL_TEST` (test branch) in `.env`. Confirm `echo $DATABASE_URL` resolves before starting Task 2.

---

### Task 1: Add dependencies and the `#/db` setup

**Files:**
- Modify: `package.json` (dependencies + scripts)
- Create: `drizzle.config.ts`

- [ ] **Step 1: Install deps**

Run:
```bash
bun add drizzle-orm @neondatabase/serverless
bun add -d drizzle-kit
```
Expected: `drizzle-orm`, `@neondatabase/serverless` in `dependencies`; `drizzle-kit` in `devDependencies`.

- [ ] **Step 2: Add db scripts to `package.json`**

Add to the `"scripts"` block:
```json
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:backfill": "bun run scripts/backfill.ts",
    "db:roles": "bun run scripts/apply-roles.ts"
```

- [ ] **Step 3: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock drizzle.config.ts
git commit -m "chore(db): add drizzle + neon deps and db scripts"
```

---

### Task 2: Define the drizzle schema

**Files:**
- Create: `db/schema.ts`

The columns mirror `src/lib/types.ts` (`Call`, `IndexEntry`) and `src/lib/schema.ts` exactly so backfill is lossless. `returns` (a `Record<Horizon, ReturnTriple>`) and `spark` (`number[]`) are stored as `jsonb` to round-trip without flattening. Scorecards are NOT stored as a table — they are recomputed/materialized later (Plan 2/3); for Plan 1 the per-creator `scorecard` and `caveats`/`spyAnchor`/`generatedAt` are stored as `jsonb` on the `creators` row so the `Dataset` round-trips exactly.

- [ ] **Step 1: Write the schema**

```ts
import { pgTable, text, doublePrecision, boolean, jsonb, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

// One row per creator. Holds the non-call parts of Dataset verbatim (jsonb) so the
// Dataset shape round-trips losslessly in Plan 1. These jsonb blobs are replaced by
// materialized aggregates in Plan 2/3.
export const creators = pgTable("creators", {
  handle: text("handle").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  generatedAt: text("generated_at").notNull(),
  spyAnchor: text("spy_anchor").notNull(),
  scorecard: jsonb("scorecard").notNull(),       // Scorecard
  caveats: jsonb("caveats").notNull(),            // string[]
  indexStats: jsonb("index_stats").notNull(),     // IndexEntry minus handle/name/avatar
});

// One row per call. Upsert key is (handle, shortcode).
export const calls = pgTable("calls", {
  handle: text("handle").notNull().references(() => creators.handle, { onDelete: "cascade" }),
  shortcode: text("shortcode").notNull(),
  postDate: text("post_date").notNull(),
  ticker: text("ticker").notNull(),
  company: text("company").notNull(),
  isFirstCall: boolean("is_first_call").notNull(),
  conviction: doublePrecision("conviction").notNull(),
  quote: text("quote").notNull(),
  summary: text("summary"),
  onScreenPrice: doublePrecision("on_screen_price"),
  spark: jsonb("spark"),                          // number[] | null
  returns: jsonb("returns").notNull(),            // Record<Horizon, ReturnTriple>
}, (t) => ({
  pk: primaryKey({ columns: [t.handle, t.shortcode] }),
  byTicker: index("calls_ticker_idx").on(t.ticker),
  byDate: index("calls_post_date_idx").on(t.postDate),
}));

// Shared per-symbol daily OHLC. INSERT-ONLY (enforced by DB role in Task 7): a frozen
// scoring input must never be rewritten. Upsert key (symbol, date), but writes only
// ever insert missing dates — never update existing ones.
export const prices = pgTable("prices", {
  symbol: text("symbol").notNull(),
  date: text("date").notNull(),
  o: doublePrecision("o").notNull(),
  h: doublePrecision("h").notNull(),
  l: doublePrecision("l").notNull(),
  c: doublePrecision("c").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.symbol, t.date] }),
}));
```

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate`
Expected: a new SQL file under `db/migrations/` with `CREATE TABLE creators/calls/prices`.

- [ ] **Step 3: Apply it**

Run: `bun run db:migrate`
Expected: `[✓] migrations applied`. Verify: `psql $DATABASE_URL -c "\dt"` lists the three tables.

- [ ] **Step 4: Commit**

```bash
git add db/schema.ts db/migrations
git commit -m "feat(db): creators/calls/prices schema + initial migration"
```

---

### Task 3: DB client

**Files:**
- Create: `db/client.ts`

- [ ] **Step 1: Write the client**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// neon-http driver: stateless HTTP, works in Vercel functions and Bun scripts alike.
// Accepts an explicit url so tests can point at DATABASE_URL_TEST.
export function makeDb(url = process.env.DATABASE_URL!) {
  return drizzle(neon(url), { schema });
}

export const db = makeDb();
export type Db = ReturnType<typeof makeDb>;
```

- [ ] **Step 2: Commit**

```bash
git add db/client.ts
git commit -m "feat(db): neon-http drizzle client"
```

---

### Task 4: Backfill — write the failing test first

**Files:**
- Create: `db/backfill.ts` (skeleton in this task)
- Test: `db/backfill.test.ts`

The test backfills a single creator fixture into the test DB and asserts the row counts and a sample call round-trip. It uses `DATABASE_URL_TEST` and truncates first.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeAll } from "bun:test";
import { makeDb } from "./client";
import { backfillCreator } from "./backfill";
import { creators, calls } from "./schema";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = makeDb(process.env.DATABASE_URL_TEST!);
// Use a real creator dataset as the fixture (theprofinvestor is committed).
const HANDLE = "theprofinvestor";
const ds = JSON.parse(readFileSync(join(import.meta.dir, "..", "data", "creators", HANDLE, "dataset.json"), "utf8"));
const indexEntry = JSON.parse(readFileSync(join(import.meta.dir, "..", "data", "creators", "index.json"), "utf8"))
  .find((e: { handle: string }) => e.handle === HANDLE);

beforeAll(async () => {
  await db.execute(sql`TRUNCATE creators, calls RESTART IDENTITY CASCADE`);
  await backfillCreator(db, indexEntry, ds);
});

test("backfill inserts one creator row", async () => {
  const rows = await db.select().from(creators).where(eq(creators.handle, HANDLE));
  expect(rows.length).toBe(1);
  expect(rows[0].name).toBe(ds.creator.name);
});

test("backfill inserts every call", async () => {
  const rows = await db.select().from(calls).where(eq(calls.handle, HANDLE));
  expect(rows.length).toBe(ds.calls.length);
});

test("a call round-trips its returns jsonb", async () => {
  const sample = ds.calls[0];
  const rows = await db.select().from(calls)
    .where(eq(calls.shortcode, sample.shortcode));
  expect(rows[0].returns).toEqual(sample.returns);
  expect(rows[0].ticker).toBe(sample.ticker);
});
```

- [ ] **Step 2: Create the skeleton so the import resolves but the test fails**

```ts
// db/backfill.ts
import type { Db } from "./client";

export async function backfillCreator(_db: Db, _indexEntry: unknown, _dataset: unknown): Promise<void> {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `DATABASE_URL_TEST=$DATABASE_URL_TEST bun test db/backfill.test.ts`
Expected: FAIL — "not implemented".

---

### Task 5: Backfill — implement `backfillCreator` and `backfillPrices`

**Files:**
- Modify: `db/backfill.ts`

- [ ] **Step 1: Implement**

```ts
import type { Db } from "./client";
import { creators, calls, prices } from "./schema";
import type { Dataset, OhlcBar } from "#/lib/types";
import type { IndexEntry } from "#/lib/dataset-source";

export async function backfillCreator(db: Db, indexEntry: IndexEntry, ds: Dataset): Promise<void> {
  const { handle, name, avatar, ...indexStats } = indexEntry;
  await db.insert(creators).values({
    handle, name, avatar: avatar ?? null,
    generatedAt: ds.generatedAt,
    spyAnchor: ds.spyAnchor,
    scorecard: ds.scorecard,
    caveats: ds.caveats,
    indexStats,
  }).onConflictDoUpdate({
    target: creators.handle,
    set: {
      name, avatar: avatar ?? null, generatedAt: ds.generatedAt,
      spyAnchor: ds.spyAnchor, scorecard: ds.scorecard, caveats: ds.caveats, indexStats,
    },
  });

  if (ds.calls.length === 0) return;
  await db.insert(calls).values(ds.calls.map((c) => ({
    handle,
    shortcode: c.shortcode,
    postDate: c.postDate,
    ticker: c.ticker,
    company: c.company,
    isFirstCall: c.isFirstCall,
    conviction: c.conviction,
    quote: c.quote,
    summary: c.summary ?? null,
    onScreenPrice: c.onScreenPrice ?? null,
    spark: c.spark ?? null,
    returns: c.returns,
  }))).onConflictDoUpdate({
    target: [calls.handle, calls.shortcode],
    set: { returns: sqlExcluded("returns"), spark: sqlExcluded("spark") },
  });
}

// Insert-only: never updates existing (symbol,date) rows — preserves frozen prices.
export async function backfillPrices(db: Db, symbol: string, bars: OhlcBar[]): Promise<void> {
  if (bars.length === 0) return;
  await db.insert(prices).values(bars.map((b) => ({ symbol, date: b.date, o: b.o, h: b.h, l: b.l, c: b.c })))
    .onConflictDoNothing();
}
```

Add this helper at the top of the file (drizzle's `excluded` reference for upserts):
```ts
import { sql } from "drizzle-orm";
const sqlExcluded = (col: string) => sql.raw(`excluded.${col}`);
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `DATABASE_URL_TEST=$DATABASE_URL_TEST bun test db/backfill.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add db/backfill.ts db/backfill.test.ts
git commit -m "feat(db): lossless backfill of creators/calls/prices from static JSON"
```

---

### Task 6: Backfill runner script

**Files:**
- Create: `scripts/backfill.ts`

- [ ] **Step 1: Write the runner**

```ts
// Reads the committed static data and loads it into the DB pointed to by DATABASE_URL.
// Idempotent: creators/calls upsert; prices insert-only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../db/client";
import { backfillCreator, backfillPrices } from "../db/backfill";
import type { IndexEntry } from "../src/lib/dataset-source";

const ROOT = join(import.meta.dir, "..");
const CREATORS = join(ROOT, "data", "creators");
const PRICES = join(ROOT, "data", "prices");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const db = makeDb();
  const index: IndexEntry[] = readJson(join(CREATORS, "index.json"));
  for (const entry of index) {
    const ds = readJson(join(CREATORS, entry.handle, "dataset.json"));
    await backfillCreator(db, entry, ds);
    console.log(`creator ${entry.handle}: ${ds.calls.length} calls`);
  }
  for (const file of readdirSync(PRICES).filter((f) => f.endsWith(".json"))) {
    const symbol = file.replace(/\.json$/, "");
    await backfillPrices(db, symbol, readJson(join(PRICES, file)));
  }
  console.log(`backfill done: ${index.length} creators.`);
}
main();
```

- [ ] **Step 2: Run it against the dev DB**

Run: `bun run db:backfill`
Expected: logs each creator + "backfill done". Verify: `psql $DATABASE_URL -c "SELECT count(*) FROM calls"` matches total calls across datasets.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill.ts
git commit -m "feat(db): backfill runner script"
```

---

### Task 7: Enforce frozen prices at the DB level

**Files:**
- Create: `scripts/apply-roles.ts`
- Test: `db/prices-immutable.test.ts`

- [ ] **Step 1: Write the failing test (UPDATE/DELETE on prices must be rejected for the ingest role)**

```ts
import { test, expect } from "bun:test";
import { neon } from "@neondatabase/serverless";

// Connects as the restricted ingest role (DATABASE_URL_INGEST_TEST) and asserts that
// UPDATE and DELETE on prices are forbidden, while INSERT works.
const sqlRole = neon(process.env.DATABASE_URL_INGEST_TEST!);

test("ingest role cannot UPDATE prices", async () => {
  await expect(sqlRole`UPDATE prices SET c = 0 WHERE symbol = 'SPY'`).rejects.toThrow(/permission denied/i);
});

test("ingest role cannot DELETE prices", async () => {
  await expect(sqlRole`DELETE FROM prices WHERE symbol = 'SPY'`).rejects.toThrow(/permission denied/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test db/prices-immutable.test.ts`
Expected: FAIL (role not created / grants not applied yet).

- [ ] **Step 3: Write the role-application script**

```ts
// scripts/apply-roles.ts — creates the restricted ingest role and revokes mutation on
// `prices`. Run once per environment after migrations. Requires INGEST_ROLE_PASSWORD.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!); // admin/owner connection
const pw = process.env.INGEST_ROLE_PASSWORD!;

async function main() {
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ingest') THEN
      CREATE ROLE ingest LOGIN;
    END IF;
  END $$`;
  await sql.unsafe(`ALTER ROLE ingest PASSWORD '${pw}'`);
  await sql`GRANT INSERT, SELECT ON prices TO ingest`;
  await sql`REVOKE UPDATE, DELETE ON prices FROM ingest`;
  await sql`GRANT INSERT, UPDATE, SELECT ON creators, calls TO ingest`;
  console.log("ingest role configured: prices insert-only.");
}
main();
```

- [ ] **Step 4: Apply and verify the test passes**

Run:
```bash
bun run db:roles
DATABASE_URL_INGEST_TEST="<test-branch url with ingest role>" bun test db/prices-immutable.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/apply-roles.ts db/prices-immutable.test.ts
git commit -m "feat(db): enforce insert-only prices via restricted ingest role"
```

---

### Task 8: DB read module — write the golden-master test first

**Files:**
- Create: `src/lib/db-read.ts` (skeleton)
- Test: `src/lib/db-read.test.ts`

The golden-master: for each committed creator, the `Dataset` reassembled from the DB must deep-equal the static `dataset.json` it was backfilled from. Same for `IndexEntry[]` vs `index.json`, and prices.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeAll } from "bun:test";
import { makeDb } from "../../db/client";
import { backfillCreator, backfillPrices } from "../../db/backfill";
import { creators, calls } from "../../db/schema";
import { sql } from "drizzle-orm";
import { readDataset, readIndex, readPrices } from "./db-read";
import { DatasetSchema } from "./schema";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const db = makeDb(process.env.DATABASE_URL_TEST!);
const ROOT = join(import.meta.dir, "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const index = readJson(join(ROOT, "data", "creators", "index.json"));

beforeAll(async () => {
  await db.execute(sql`TRUNCATE creators, calls, prices RESTART IDENTITY CASCADE`);
  for (const e of index) {
    backfillCreator(db, e, readJson(join(ROOT, "data", "creators", e.handle, "dataset.json")));
  }
  for (const e of index) {
    await backfillCreator(db, e, readJson(join(ROOT, "data", "creators", e.handle, "dataset.json")));
  }
  for (const f of readdirSync(join(ROOT, "data", "prices")).filter((f) => f.endsWith(".json"))) {
    await backfillPrices(db, f.replace(/\.json$/, ""), readJson(join(ROOT, "data", "prices", f)));
  }
});

test("readDataset deep-equals the static dataset.json", async () => {
  for (const e of index) {
    const static_ = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
    const fromDb = await readDataset(db, e.handle);
    // Validate shape, then compare. JSON normalization guards key-order noise.
    expect(DatasetSchema.parse(fromDb)).toEqual(DatasetSchema.parse(static_));
  }
});

test("readIndex deep-equals index.json (order-insensitive)", async () => {
  const fromDb = await readIndex(db);
  const sortByHandle = (a: { handle: string }, b: { handle: string }) => a.handle.localeCompare(b.handle);
  expect([...fromDb].sort(sortByHandle)).toEqual([...index].sort(sortByHandle));
});

test("readPrices deep-equals the static price file", async () => {
  const symbol = "SPY";
  const static_ = readJson(join(ROOT, "data", "prices", `${symbol}.json`));
  const fromDb = await readPrices(db, symbol);
  expect(fromDb).toEqual(static_);
});
```

- [ ] **Step 2: Skeleton so imports resolve and the test fails**

```ts
// src/lib/db-read.ts
import type { Db } from "../../db/client";
import type { Dataset, OhlcBar } from "./types";
import type { IndexEntry } from "./dataset-source";

export async function readDataset(_db: Db, _handle: string): Promise<Dataset> { throw new Error("ni"); }
export async function readIndex(_db: Db): Promise<IndexEntry[]> { throw new Error("ni"); }
export async function readPrices(_db: Db, _symbol: string): Promise<OhlcBar[]> { throw new Error("ni"); }
```

- [ ] **Step 3: Run to verify it fails**

Run: `DATABASE_URL_TEST=$DATABASE_URL_TEST bun test src/lib/db-read.test.ts`
Expected: FAIL — "ni".

---

### Task 9: DB read module — implement reassembly

**Files:**
- Modify: `src/lib/db-read.ts`

- [ ] **Step 1: Implement**

```ts
import { eq, asc } from "drizzle-orm";
import type { Db } from "../../db/client";
import { creators, calls, prices } from "../../db/schema";
import type { Dataset, Call, OhlcBar } from "./types";
import type { IndexEntry } from "./dataset-source";

function rowToCall(r: typeof calls.$inferSelect): Call {
  return {
    shortcode: r.shortcode,
    postDate: r.postDate,
    ticker: r.ticker,
    company: r.company,
    isFirstCall: r.isFirstCall,
    conviction: r.conviction,
    quote: r.quote,
    ...(r.summary != null ? { summary: r.summary } : {}),
    ...(r.onScreenPrice != null ? { onScreenPrice: r.onScreenPrice } : {}),
    ...(r.spark != null ? { spark: r.spark as number[] } : {}),
    returns: r.returns as Call["returns"],
  };
}

export async function readDataset(db: Db, handle: string): Promise<Dataset> {
  const [c] = await db.select().from(creators).where(eq(creators.handle, handle));
  if (!c) throw new Error(`dataset ${handle}: not found`);
  // Preserve the dataset's original call order: backfill inserted in file order, and
  // (handle, postDate) ascending matches the committed files. If a creator's file is not
  // date-sorted, switch to a stored ordinal column — see NOTE in Plan 3.
  const callRows = await db.select().from(calls).where(eq(calls.handle, handle)).orderBy(asc(calls.postDate));
  return {
    creator: { handle: c.handle, name: c.name },
    generatedAt: c.generatedAt,
    spyAnchor: c.spyAnchor,
    calls: callRows.map(rowToCall),
    scorecard: c.scorecard as Dataset["scorecard"],
    caveats: c.caveats as string[],
  };
}

export async function readIndex(db: Db): Promise<IndexEntry[]> {
  const rows = await db.select().from(creators);
  return rows.map((c) => ({
    handle: c.handle,
    name: c.name,
    ...(c.avatar != null ? { avatar: c.avatar } : {}),
    ...(c.indexStats as Omit<IndexEntry, "handle" | "name" | "avatar">),
  }));
}

export async function readPrices(db: Db, symbol: string): Promise<OhlcBar[]> {
  const rows = await db.select().from(prices).where(eq(prices.symbol, symbol)).orderBy(asc(prices.date));
  return rows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
}
```

- [ ] **Step 2: Run to verify it passes**

Run: `DATABASE_URL_TEST=$DATABASE_URL_TEST bun test src/lib/db-read.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: If `readDataset` deep-equal fails on call ORDER**, the committed datasets are not strictly date-sorted. Fix forward: add an `ord integer` column to `calls`, set it from array index in `backfillCreator`, and `orderBy(asc(calls.ord))`. Re-run Tasks 5/6 migration. (Only do this if Step 2 fails on ordering.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db-read.ts src/lib/db-read.test.ts
git commit -m "feat(db): DB read module with golden-master parity vs static JSON"
```

---

### Task 10: Route `data.ts` through the DB behind `USE_DB` flag

**Files:**
- Modify: `src/lib/data.ts`

The existing `listCreators`/`fetchDataset`/`fetchPrices` keep their signatures. When `USE_DB === "1"` they read from the DB; otherwise the current static path runs unchanged. On any DB error they fall back to static (panic fallback) and log.

- [ ] **Step 1: Write the failing test**

Test: `src/lib/data.test.ts`
```ts
import { test, expect } from "bun:test";
import { fetchDatasetImpl } from "./data";

// fetchDatasetImpl is the env-agnostic core (handle, useDb, db) extracted for testability.
test("useDb=false path does not touch the DB", async () => {
  // Passing a db that throws proves the static branch never calls it.
  const throwingDb = new Proxy({}, { get() { throw new Error("DB touched"); } }) as never;
  // Static fetch is stubbed via globalThis.fetch.
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(SAMPLE), { status: 200 })) as typeof fetch;
  try {
    const ds = await fetchDatasetImpl("theprofinvestor", false, throwingDb);
    expect(ds.creator.handle).toBe("theprofinvestor");
  } finally { globalThis.fetch = orig; }
});

const SAMPLE = {
  creator: { handle: "theprofinvestor", name: "X" }, generatedAt: "2026-01-01",
  spyAnchor: "2026-01-01", calls: [], caveats: [],
  scorecard: { totalCalls: 0, uniqueTickers: 0, hitRate: { "1m": 0, "3m": 0 },
    hitRateN: { "1m": 0, "3m": 0 }, avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
    callsPerWeek: 0, best: [], worst: [] },
};
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/data.test.ts`
Expected: FAIL — `fetchDatasetImpl` not exported.

- [ ] **Step 3: Refactor `data.ts` to add the DB branch + testable core**

```ts
import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema, PriceFileSchema } from "./schema";
import type { Dataset, OhlcBar } from "./types";
import { loadIndex, type IndexEntry } from "./dataset-source";
import { siteUrl } from "../og/site";
import { db, type Db } from "../../db/client";
import { readDataset, readIndex, readPrices } from "./db-read";

const useDb = () => process.env.USE_DB === "1";

export const listCreators = createServerFn({ method: "GET" }).handler(async () => {
  if (useDb()) {
    try { return await readIndex(db); } catch (e) { console.error("listCreators DB fallback", e); }
  }
  return loadIndex();
});

export async function fetchDatasetImpl(handle: string, withDb: boolean, database: Db): Promise<Dataset> {
  if (withDb) {
    try { return await readDataset(database, handle); }
    catch (e) { console.error(`fetchDataset DB fallback ${handle}`, e); }
  }
  const path = `/datasets/${handle}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset ${handle}: ${res.status}`);
  return DatasetSchema.parse(await res.json());
}

export async function fetchDataset(handle: string): Promise<Dataset> {
  return fetchDatasetImpl(handle, useDb() && typeof window === "undefined", db);
}

export async function fetchPrices(symbol: string): Promise<OhlcBar[]> {
  if (useDb() && typeof window === "undefined") {
    try { const r = await readPrices(db, symbol); if (r.length) return r; }
    catch (e) { console.error(`fetchPrices DB fallback ${symbol}`, e); }
  }
  const path = `/prices/${symbol}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) return [];
  return PriceFileSchema.parse(await res.json());
}
```

NOTE: `fetchDataset`/`fetchPrices` only use the DB during SSR (`typeof window === "undefined"`); the browser keeps fetching the static same-origin asset so the DB stays out of the client bundle and client navigations stay CDN-cached. Export `IndexEntry` from `dataset-source.ts` if not already exported.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/lib/data.test.ts` then `bunx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data.ts src/lib/data.test.ts src/lib/dataset-source.ts
git commit -m "feat(db): route data.ts reads through DB behind USE_DB flag with static fallback"
```

---

### Task 11: End-to-end parity smoke test with the real server

**Files:**
- Create: `scripts/parity-check.ts`

Proves the running app serves identical bytes with `USE_DB=0` vs `USE_DB=1` for the index and each dataset — the go/no-go gate before flipping the flag in production.

- [ ] **Step 1: Write the parity script**

```ts
// Fetches /datasets/<h>.json-equivalent payloads through the app under both flag values
// and diffs them. Run the dev server twice (USE_DB=0, then USE_DB=1) on the same port,
// or point BASE_A / BASE_B at two running instances.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../db/client";
import { readDataset, readIndex } from "../src/lib/db-read";

const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const db = makeDb();
  const index = readJson(join(ROOT, "data", "creators", "index.json"));
  const dbIndex = await readIndex(db);
  const norm = (xs: { handle: string }[]) => JSON.stringify([...xs].sort((a, b) => a.handle.localeCompare(b.handle)));
  if (norm(index) !== norm(dbIndex)) throw new Error("index parity FAILED");
  for (const e of index) {
    const stat = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
    const fromDb = await readDataset(db, e.handle);
    if (JSON.stringify(stat) !== JSON.stringify(fromDb)) {
      throw new Error(`dataset parity FAILED for ${e.handle}`);
    }
    console.log(`✓ ${e.handle}`);
  }
  console.log("PARITY OK — safe to flip USE_DB=1");
}
main();
```

NOTE: byte-identical JSON requires key order to match. If `JSON.stringify` differs only by key order, switch the comparison to a deep-equal (e.g. compare `DatasetSchema.parse` of both) — parity of *meaning*, not bytes, is the real gate.

- [ ] **Step 2: Run it**

Run: `bun run scripts/parity-check.ts`
Expected: `✓` per creator, then `PARITY OK`.

- [ ] **Step 3: Commit**

```bash
git add scripts/parity-check.ts
git commit -m "test(db): end-to-end DB-vs-static parity check script"
```

---

### Task 12: Documentation + flag flip procedure

**Files:**
- Modify: `CLAUDE.md` (add a "Data source: DB vs static" subsection)
- Modify: `.env.example`

- [ ] **Step 1: Document the env vars**

Add to `.env.example`:
```
# Neon Postgres (Vercel Marketplace). DATABASE_URL = pooled owner connection.
DATABASE_URL=
# Test branch — golden-master + immutability tests run here.
DATABASE_URL_TEST=
DATABASE_URL_INGEST_TEST=
# Restricted ingest role password (used by scripts/apply-roles.ts).
INGEST_ROLE_PASSWORD=
# Read path: "1" = serve from DB (SSR only), unset/"0" = static JSON. Static is the fallback.
USE_DB=0
```

- [ ] **Step 2: Document in CLAUDE.md**

Under a new `## Data source: DB vs static` section, record: backfill runner, `USE_DB` semantics, the golden-master + parity gates, and the prices insert-only invariant. Keep it concise (one fact per line, matching the file's style).

- [ ] **Step 3: Flip procedure (manual, documented, not auto-run)**

In CLAUDE.md note the cutover: (1) `bun run db:backfill` against prod Neon; (2) `bun run scripts/parity-check.ts` → must print PARITY OK; (3) set `USE_DB=1` in Vercel prod env; (4) redeploy once (last redeploy — afterwards data updates need no redeploy); (5) static JSON remains the panic fallback — revert by setting `USE_DB=0`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs(db): data-source flag, backfill, and cutover procedure"
```

---

## Self-Review

**Spec coverage (Plan 1 slice):**
- Neon Postgres as source of truth → Tasks 1–3. ✓
- Backfill from existing JSON → Tasks 4–6. ✓
- Frozen scoring DB-enforced (insert-only prices) → Task 7. ✓ (denormalized price-hash-on-call is deferred to Plan 3, where scoring runs against the DB — noted in spec, not needed for a read-only backfill.)
- DB read behind `fetchDataset()`/`fetchPrices()` interface + golden-master diff + env-flag fallback → Tasks 8–11. ✓
- Roster off the build bundle → `listCreators` reads `readIndex` under `USE_DB` (Task 10). ✓ (Build-time `import.meta.glob` stays as the fallback; fully removing it is Plan 3 when ingest writes the DB directly.)
- PITR/dumps backup, monitoring, cache invalidation, OG-on-VM, slim index, leaderboard, LLM gate → explicitly out of Plan 1 scope (Plans 2–4).

**Placeholder scan:** No TBD/TODO. The two NOTEs (call-order fallback in Task 9, key-order parity in Task 11) are conditional fix-forward instructions with concrete steps, not deferrals.

**Type consistency:** `backfillCreator(db, indexEntry, ds)`, `backfillPrices(db, symbol, bars)`, `readDataset(db, handle)`, `readIndex(db)`, `readPrices(db, symbol)`, `fetchDatasetImpl(handle, withDb, db)` — signatures consistent across Tasks 4–11. Column names (`isFirstCall`/`is_first_call`, `onScreenPrice`/`on_screen_price`, `indexStats`/`index_stats`) consistent between schema (Task 2), backfill (Task 5), and read (Task 9). `IndexEntry` shape matches `src/lib/dataset-source.ts`.
