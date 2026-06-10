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
  ord: integer("ord").notNull(),                  // position in index.json — deterministic roster order
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
  ord: integer("ord").notNull(),                  // array index in the source dataset — preserves file order
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

- [ ] **Step 3: Apply it to BOTH the dev DB and the test branch**

Migrations only target `DATABASE_URL`; the test branch (a point-in-time copy) does not inherit migrations created after it was branched, so apply explicitly to both:
```bash
bun run db:migrate
DATABASE_URL="$DATABASE_URL_TEST" bun run db:migrate
```
Expected: `[✓] migrations applied` twice. Verify: `psql $DATABASE_URL -c "\dt"` and `psql $DATABASE_URL_TEST -c "\dt"` both list the three tables.

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

export type Db = ReturnType<typeof makeDb>;

// Lazy, memoized. NEVER construct at module load: data.ts is reachable from client
// routes, and eager construction reads process.env + bundles neon into the client.
let _db: Db | undefined;
export function getDb(): Db { return (_db ??= makeDb()); }
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

All three DB test files (this, `db-read.test.ts`, `prices-immutable.test.ts`) MUST gate on env so `bun test` still passes for anyone without a test DB. Bun runs test files serially in one process, so the shared `TRUNCATE` across files is not a race.

```ts
import { test, expect, beforeAll, describe } from "bun:test";
import { makeDb } from "./client";
import { backfillCreator } from "./backfill";
import { creators, calls } from "./schema";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUN = !!process.env.DATABASE_URL_TEST;
const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
// Derive the fixture from the index so handle casing can never drift (handles are
// "kevvonz" and "TheProfInvestor" — case matters on Linux CI).
const index = RUN ? readJson(join(ROOT, "data", "creators", "index.json")) : [];
const indexEntry = index.find((e: { handle: string }) => /prof/i.test(e.handle)) ?? index[0];
const HANDLE = indexEntry?.handle;
const ds = RUN ? readJson(join(ROOT, "data", "creators", HANDLE, "dataset.json")) : null;

describe.skipIf(!RUN)("backfillCreator", () => {
const db = makeDb(process.env.DATABASE_URL_TEST!);

beforeAll(async () => {
  await db.execute(sql`TRUNCATE creators, calls RESTART IDENTITY CASCADE`);
  await backfillCreator(db, indexEntry, ds, 0);
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
}); // describe.skipIf
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

// `ord` (index position) is required by the caller so creator roster order is
// deterministic; pass it from the index array index in the runner.
export async function backfillCreator(db: Db, indexEntry: IndexEntry, ds: Dataset, ord: number): Promise<void> {
  const { handle, name, avatar, ...indexStats } = indexEntry;
  const creatorRow = {
    handle, name, avatar: avatar ?? null, ord,
    generatedAt: ds.generatedAt, spyAnchor: ds.spyAnchor,
    scorecard: ds.scorecard, caveats: ds.caveats, indexStats,
  };
  await db.insert(creators).values(creatorRow).onConflictDoUpdate({
    target: creators.handle,
    set: { name, avatar: avatar ?? null, ord, generatedAt: ds.generatedAt,
      spyAnchor: ds.spyAnchor, scorecard: ds.scorecard, caveats: ds.caveats, indexStats },
  });

  if (ds.calls.length === 0) return;
  const rows = ds.calls.map((c, i) => ({
    handle,
    shortcode: c.shortcode,
    ord: i,                               // array position preserves file order (postDate has ties)
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
  }));
  // Chunk to keep each neon-http request body well under limits (TheProfInvestor: 880 calls).
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(calls).values(rows.slice(i, i + 200)).onConflictDoUpdate({
      target: [calls.handle, calls.shortcode],
      // Update every non-PK column so a re-run after a re-score never leaves stale data.
      set: {
        ord: ex("ord"), postDate: ex("post_date"), ticker: ex("ticker"), company: ex("company"),
        isFirstCall: ex("is_first_call"), conviction: ex("conviction"), quote: ex("quote"),
        summary: ex("summary"), onScreenPrice: ex("on_screen_price"), spark: ex("spark"),
        returns: ex("returns"),
      },
    });
  }
}

// Insert-only: never updates existing (symbol,date) rows — preserves frozen prices.
export async function backfillPrices(db: Db, symbol: string, bars: OhlcBar[]): Promise<void> {
  if (bars.length === 0) return;
  await db.insert(prices).values(bars.map((b) => ({ symbol, date: b.date, o: b.o, h: b.h, l: b.l, c: b.c })))
    .onConflictDoNothing();
}
```

Add this helper at the top of the file (drizzle `excluded`-row reference for upserts; quote the column to be safe with reserved words like `returns`):
```ts
import { sql } from "drizzle-orm";
const ex = (col: string) => sql.raw(`excluded."${col}"`);
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
import { eq, sql } from "drizzle-orm";
import { makeDb } from "../db/client";
import { calls } from "../db/schema";
import { backfillCreator, backfillPrices } from "../db/backfill";
import type { IndexEntry } from "../src/lib/dataset-source";

const ROOT = join(import.meta.dir, "..");
const CREATORS = join(ROOT, "data", "creators");
const PRICES = join(ROOT, "data", "prices");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const db = makeDb();
  const index: IndexEntry[] = readJson(join(CREATORS, "index.json"));
  for (const [ord, entry] of index.entries()) {
    const ds = readJson(join(CREATORS, entry.handle, "dataset.json"));
    await backfillCreator(db, entry, ds, ord);
    // Guard against the (handle, shortcode) PK silently merging rows if a post ever
    // yields two calls: inserted count must equal the source call count.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(eq(calls.handle, entry.handle));
    if (n !== ds.calls.length) throw new Error(`${entry.handle}: ${n} rows != ${ds.calls.length} calls`);
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
import { test, expect, describe } from "bun:test";
import { neon } from "@neondatabase/serverless";

// Connects as the restricted ingest role (DATABASE_URL_INGEST_TEST = ingest creds at the
// TEST-branch host) and asserts UPDATE/DELETE on prices are forbidden.
describe.skipIf(!process.env.DATABASE_URL_INGEST_TEST)("prices immutability", () => {
const sqlRole = neon(process.env.DATABASE_URL_INGEST_TEST!);

test("ingest role cannot UPDATE prices", async () => {
  await expect(sqlRole`UPDATE prices SET c = 0 WHERE symbol = 'SPY'`).rejects.toThrow(/permission denied/i);
});

test("ingest role cannot DELETE prices", async () => {
  await expect(sqlRole`DELETE FROM prices WHERE symbol = 'SPY'`).rejects.toThrow(/permission denied/i);
});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test db/prices-immutable.test.ts`
Expected: FAIL (role not created / grants not applied yet).

- [ ] **Step 3: Write the role-application script**

```ts
// scripts/apply-roles.ts — creates the restricted ingest role and revokes mutation on
// `prices`. Run once per environment (against DATABASE_URL) after migrations.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!); // admin/owner connection
const pw = process.env.INGEST_ROLE_PASSWORD!;
// DDL cannot use bind params, so validate the password against a safe charset and
// single-quote-escape it. Operator-supplied env var, but never interpolate unchecked.
if (!/^[A-Za-z0-9_-]{16,}$/.test(pw)) {
  throw new Error("INGEST_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
}

async function main() {
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ingest') THEN
      CREATE ROLE ingest LOGIN;
    END IF;
  END $$`;
  // sql.unsafe() returns a FRAGMENT, not an executor — use sql.query() to actually run DDL.
  await sql.query(`ALTER ROLE ingest PASSWORD '${pw.replaceAll("'", "''")}'`);
  await sql`GRANT INSERT, SELECT ON prices TO ingest`;
  await sql`REVOKE UPDATE, DELETE ON prices FROM ingest`;
  await sql`GRANT INSERT, UPDATE, SELECT ON creators, calls TO ingest`;
  console.log("ingest role configured: prices insert-only.");
}
main();
```

- [ ] **Step 4: Apply to the test branch and verify the test passes**

The role must exist on the TEST branch (a branch created before the role does not inherit it). Apply there and point the test at the ingest credentials on the test-branch host:
```bash
DATABASE_URL="$DATABASE_URL_TEST" bun run db:roles
DATABASE_URL_INGEST_TEST="<ingest creds @ test-branch host>" bun test db/prices-immutable.test.ts
```
Expected: PASS (2 tests). Also apply to prod/dev later, at cutover: `bun run db:roles`.

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
import { test, expect, beforeAll, describe } from "bun:test";
import { makeDb } from "../../db/client";
import { backfillCreator, backfillPrices } from "../../db/backfill";
import { sql } from "drizzle-orm";
import { readDataset, readIndex, readPrices } from "./db-read";
import { DatasetSchema } from "./schema";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RUN = !!process.env.DATABASE_URL_TEST;
const ROOT = join(import.meta.dir, "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const index = RUN ? readJson(join(ROOT, "data", "creators", "index.json")) : [];

describe.skipIf(!RUN)("DB read golden master", () => {
const db = makeDb(process.env.DATABASE_URL_TEST!);

beforeAll(async () => {
  await db.execute(sql`TRUNCATE creators, calls, prices RESTART IDENTITY CASCADE`);
  for (const [ord, e] of index.entries()) {
    await backfillCreator(db, e, readJson(join(ROOT, "data", "creators", e.handle, "dataset.json")), ord);
  }
  for (const f of readdirSync(join(ROOT, "data", "prices")).filter((f) => f.endsWith(".json"))) {
    await backfillPrices(db, f.replace(/\.json$/, ""), readJson(join(ROOT, "data", "prices", f)));
  }
});

test("readDataset deep-equals the static dataset.json (incl. call order)", async () => {
  for (const e of index) {
    const static_ = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
    const fromDb = await readDataset(db, e.handle);
    // Schema-shaped deep-equal (validates shape + compares meaning, key-order-insensitive).
    // Array order IS asserted by toEqual — proves the `ord` column reconstructs file order.
    expect(DatasetSchema.parse(fromDb)).toEqual(DatasetSchema.parse(static_));
  }
});

test("readIndex equals index.json in order", async () => {
  const fromDb = await readIndex(db);
  expect(fromDb).toEqual(index); // order-sensitive: WorkspaceRail roster order must be stable
});

test("readPrices deep-equals the static price file", async () => {
  const symbol = "SPY";
  const static_ = readJson(join(ROOT, "data", "prices", `${symbol}.json`));
  const fromDb = await readPrices(db, symbol);
  expect(fromDb).toEqual(static_);
});
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
  // onScreenPrice is present on EVERY committed call (explicit `null` on 189 of them), so
  // emit it unconditionally — a missing key would break the golden master (missing ≠ null).
  // summary/spark are always present and non-null in the data, so the conditional spread
  // always includes them; kept conditional to honor the optional type.
  return {
    shortcode: r.shortcode,
    postDate: r.postDate,
    ticker: r.ticker,
    company: r.company,
    isFirstCall: r.isFirstCall,
    conviction: r.conviction,
    quote: r.quote,
    ...(r.summary != null ? { summary: r.summary } : {}),
    onScreenPrice: r.onScreenPrice,
    ...(r.spark != null ? { spark: r.spark as number[] } : {}),
    returns: r.returns as Call["returns"],
  };
}

export async function readDataset(db: Db, handle: string): Promise<Dataset> {
  const [c] = await db.select().from(creators).where(eq(creators.handle, handle));
  if (!c) throw new Error(`dataset ${handle}: not found`);
  // `ord` (array index at backfill) reconstructs exact file order — postDate has ties
  // (597 dup dates for TheProfInvestor) so a date sort would scramble it.
  const callRows = await db.select().from(calls).where(eq(calls.handle, handle)).orderBy(asc(calls.ord));
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
  const rows = await db.select().from(creators).orderBy(asc(creators.ord));
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

- [ ] **Step 3: Commit**

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

Test: `src/lib/data.test.ts`. In `bun test`, `typeof window === "undefined"` is true and `USE_DB` is unset, so `serverUseDb()` is false → the static branch runs and never imports the DB. The test stubs `fetch` and asserts the parsed dataset comes back.
```ts
import { test, expect } from "bun:test";
import { fetchDataset } from "./data";

const SAMPLE = {
  creator: { handle: "TheProfInvestor", name: "X" }, generatedAt: "2026-01-01",
  spyAnchor: "2026-01-01", calls: [], caveats: [],
  scorecard: { totalCalls: 0, uniqueTickers: 0, hitRate: { "1m": 0, "3m": 0 },
    hitRateN: { "1m": 0, "3m": 0 }, avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
    callsPerWeek: 0, best: [], worst: [] },
};

test("static branch (USE_DB unset) parses the fetched dataset", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(SAMPLE), { status: 200 })) as typeof fetch;
  try {
    const ds = await fetchDataset("TheProfInvestor");
    expect(ds.creator.handle).toBe("TheProfInvestor");
  } finally { globalThis.fetch = orig; }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/lib/data.test.ts`
Expected: FAIL — `fetchDataset` not exported yet / module error (the new `data.ts` is written in Step 3).

- [ ] **Step 3: Refactor `data.ts` to add the DB branch + testable core**

CRITICAL: `data.ts` is imported by client routes, so it must NOT eagerly import the DB client or read `process.env` at module top-level (the browser has no `process`, and `db/client.ts` calls `neon(process.env.DATABASE_URL!)` at module load — that would crash every client page and pull `@neondatabase/serverless` into the client bundle / break `vite build`). Therefore: (1) the window guard comes FIRST, before any `process.env` read; (2) DB modules are `await import(...)`-ed only inside the server-only branch; (3) `db/client.ts` must memoize lazily (no eager `export const db`).

`db/client.ts` already exposes the lazy `getDb()` (Task 3). Now `src/lib/data.ts`:
```ts
import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema, PriceFileSchema } from "./schema";
import type { Dataset, OhlcBar } from "./types";
import { loadIndex, type IndexEntry } from "./dataset-source";
import { siteUrl } from "../og/site";

// Server-only: window guard FIRST so the client never reads process.env or imports the DB.
const serverUseDb = () => typeof window === "undefined" && process.env.USE_DB === "1";

export const listCreators = createServerFn({ method: "GET" }).handler(async () => {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readIndex } = await import("./db-read");
      return await readIndex(getDb());
    } catch (e) { console.error("listCreators DB fallback", e); }
  }
  return loadIndex();
});

export async function fetchDataset(handle: string): Promise<Dataset> {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readDataset } = await import("./db-read");
      return await readDataset(getDb(), handle);
    } catch (e) { console.error(`fetchDataset DB fallback ${handle}`, e); }
  }
  const path = `/datasets/${handle}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset ${handle}: ${res.status}`);
  return DatasetSchema.parse(await res.json());
}

export async function fetchPrices(symbol: string): Promise<OhlcBar[]> {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readPrices } = await import("./db-read");
      const r = await readPrices(getDb(), symbol);
      if (r.length) return r;
    } catch (e) { console.error(`fetchPrices DB fallback ${symbol}`, e); }
  }
  const path = `/prices/${symbol}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) return [];
  return PriceFileSchema.parse(await res.json());
}
```

NOTE: DB reads happen only during SSR; the browser keeps fetching the static same-origin asset, so the DB stays out of the client bundle and client navigations remain CDN-cached. `IndexEntry` is already exported from `dataset-source.ts`. The data.test.ts in Step 1 below tests the static branch only (no DB import); drop the earlier `fetchDatasetImpl` signature — the dynamic-import design replaces it.

- [ ] **Step 4: Verify — tests, types, AND a clean client build**

```bash
bun test src/lib/data.test.ts
bunx tsc --noEmit
USE_DB=0 bun run build
```
Expected: tests PASS; no type errors; **`vite build` succeeds with `DATABASE_URL` unset** — this is the gate that proves the DB client did not leak into the client bundle. (`bun test`/`tsc` alone cannot catch a client-bundle import leak.) If the build fails resolving `@neondatabase/serverless` in a client chunk, the dynamic-import/window-guard ordering was not followed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data.ts src/lib/data.test.ts
git commit -m "feat(db): route data.ts reads through DB behind USE_DB flag with static fallback"
```

---

### Task 11: DB-vs-static parity check against the target database

**Files:**
- Create: `scripts/parity-check.ts`

The pre-cutover go/no-go gate: run against the **prod** DB after backfill to prove the DB reassembles every committed dataset and the index identically. jsonb does not preserve key order, so compare by deep-equal of a canonical (key-sorted) serialization, not raw `JSON.stringify` — parity of *meaning* is the gate, not bytes.

- [ ] **Step 1: Write the parity script**

```ts
// Compares DB-reassembled output vs the committed static JSON for the DB at DATABASE_URL.
// Run AFTER `bun run db:backfill` against the target (prod) DB, before flipping USE_DB=1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../db/client";
import { readDataset, readIndex } from "../src/lib/db-read";

const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// Canonical JSON: object keys sorted recursively so key-order differences don't false-fail.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function main() {
  const db = makeDb();
  const index = readJson(join(ROOT, "data", "creators", "index.json"));
  if (!eq(index, await readIndex(db))) throw new Error("index parity FAILED");
  for (const e of index) {
    const stat = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
    if (!eq(stat, await readDataset(db, e.handle))) throw new Error(`dataset parity FAILED for ${e.handle}`);
    console.log(`✓ ${e.handle}`);
  }
  console.log("PARITY OK — safe to flip USE_DB=1");
}
main();
```

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

In CLAUDE.md note the cutover: (1) apply migrations + roles to prod: `bun run db:migrate && bun run db:roles`; (2) `bun run db:backfill` against prod Neon; (3) `bun run scripts/parity-check.ts` → must print PARITY OK; (4) set `USE_DB=1` in Vercel prod env; (5) redeploy once (last redeploy — afterwards data updates need no redeploy); (6) static JSON remains the panic fallback — revert instantly by setting `USE_DB=0`. **Transitional caveat:** until Plan 3 adds caching, each SSR creator-page render pulls its full dataset (TheProfInvestor ≈ 1.4 MB) from Neon uncached, replacing a CDN-cached static fetch — watch SSR latency before/after the flip; if it regresses, revert and prioritize Plan 3 caching.

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

**Placeholder scan:** No TBD/TODO. No conditional fix-forward steps remain (the call-order contingency was resolved by the `ord` column; the parity comparison uses canonical deep-equal directly).

**Type consistency:** `backfillCreator(db, indexEntry, ds, ord)`, `backfillPrices(db, symbol, bars)`, `readDataset(db, handle)`, `readIndex(db)`, `readPrices(db, symbol)`, `getDb()` — signatures consistent across Tasks 3–11. Column names (`isFirstCall`/`is_first_call`, `onScreenPrice`/`on_screen_price`, `ord`, `indexStats`/`index_stats`) consistent between schema (Task 2), backfill (Task 5), and read (Task 9). `IndexEntry` matches `src/lib/dataset-source.ts` (already exported).

**Review-applied fixes (Fable 5, verified against repo data):** `ord` column for deterministic call/roster order (postDate has 597 ties); `onScreenPrice` emitted unconditionally (189 explicit nulls); handles use real casing (`TheProfInvestor`); `sql.query` (not no-op `sql.unsafe`) for role DDL with password validation; migrations + roles applied to the test branch explicitly; lazy `getDb()` + window-guard-first + dynamic imports so the DB never enters the client bundle (gated by `USE_DB=0 bun run build`); all three DB test files gated with `describe.skipIf` so `bun test` passes without a test DB; insert chunking at 200 rows; all non-PK columns updated on upsert; canonical deep-equal for parity.
