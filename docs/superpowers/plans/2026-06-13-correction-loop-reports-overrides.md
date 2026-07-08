# Correction Loop: public reports → operator override store → re-score → propagate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the site ship possibly-incorrect calls but be architecturally self-correcting — anyone can flag a call as wrong from the proof drawer, those reports accumulate into an operator review queue, the operator records a durable override, and a re-score recomputes and propagates the fix to the live site without it ever being clobbered by the next ingest.

**Architecture:** Two layers of one loop. (1) **Override store** — a `call_overrides` DB table read by `score()` as a deterministic final pass _after_ extraction and _before_ the scoring filter, so corrections are baked identically into `dataset.json` AND the DB (`calls`), survive re-extract (applied after it), survive backfill (the override is the _source_, not the clobbered `calls` row), and survive the VM's `git checkout -- data/` (it lives in the DB, not a static file). (2) **Report pipeline** — a public `call_reports` table written through a new INSERT-only `report` DB role via a token-free, rate-limited POST endpoint, surfaced to the operator by a review script. Propagation rides the existing Nitro→Vercel prerender bypass (`REVALIDATE_TOKEN`, wired here).

**Tech Stack:** Drizzle + `@neondatabase/serverless` (neon-http), TanStack Start server routes, Bun + `bun:test`, React + Base UI dialog / vaul drawer, PostgreSQL least-privilege roles.

**Why these decisions are locked (not free choices):**

- **Overrides in the DB, not a committed JSON.** A correction triggered on the VM must survive `git checkout -- data/` (the ephemeral-scratch policy). A static file cannot; a DB row can. This is forced by the requirement, not a preference.
- **Overrides applied at score-time, not as a post-DB patch.** Patching the DB `calls` row directly is clobbered by the next `backfillCalls` (`onConflictDoUpdate` on every column, `db/backfill.ts:44`). Applying at score-time means the correction is the _input_ to both `dataset.json` and the DB, so parity holds and re-runs stay consistent.
- **Public reports never auto-change data.** They only queue for operator review. The serve role is SELECT-only by design; the report write path is a separate INSERT-only role so a compromised endpoint can neither read nor mutate the ledger.
- **Report reasons are an enum, never free text (v1).** Avoids PII, stored XSS, and a moderation burden. Reasons are never displayed publicly (operator-only), so the queue can't become a public defamation billboard.

---

## Prerequisite

### Task 0: Merge the `quotetype-filter` branch first

This plan modifies `pipeline/score.ts`, which the `quotetype-filter` branch (commit `9aed031`) also modifies (the scope predicate). Merge it to `main` before branching the worktree for this plan, so the override wiring builds on the final `score()` signature and avoids a conflict.

- [ ] **Step 1:** From the primary checkout on `main`: `git merge --ff-only quotetype-filter` (or a normal merge if `main` advanced), confirm `bun test` + `bunx tsc --noEmit` pass, then `git worktree remove ../influencer-tracker-quotetype-filter`.
- [ ] **Step 2:** Create this plan's worktree off the updated `main`: `git worktree add ../influencer-tracker-correction-loop -b correction-loop`, then `cd` in and `bun install`.

---

## Phase 1 — Durable correction foundation (override store + revalidate)

Phase 1 is independently shippable: it makes corrections durable and propagating even with zero reports (the operator finds bad calls manually). It is the prerequisite for safely dropping the human review gate.

### Task 1: `call_overrides` schema + migration

**Files:**

- Modify: `db/schema.ts` (append the table)
- Generate: a new migration under `drizzle/`

- [ ] **Step 1: Add the table to `db/schema.ts`** (append after `artifacts`):

```ts
// Operator corrections to a call, applied by score() as a deterministic final pass
// over the extracted ReelCall[] BEFORE the isExplicitBuy&&bullish filter. Each column
// is nullable except the audit reason: a null field means "leave as classified", a
// non-null field overrides it. This is the durable, auditable replacement for
// hand-editing reel-calls.json (lost on re-extract) and for the owner-DELETE (which
// loses the evidence). Serve role must NOT see this table (see scripts/apply-roles.ts).
export const callOverrides = pgTable(
  "call_overrides",
  {
    handle: text("handle")
      .notNull()
      .references(() => creators.handle, { onDelete: "cascade" }),
    shortcode: text("shortcode").notNull(),
    ticker: text("ticker"), // null = keep classified ticker
    isExplicitBuy: boolean("is_explicit_buy"), // null = keep classified flag
    direction: text("direction"), // null = keep; else "bullish"|"bearish"|"neutral"
    reason: text("reason").notNull(), // required audit trail (verbatim quote + why)
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.handle, t.shortcode] }), // one (latest-wins) override per call
  ],
);
```

- [ ] **Step 2: Generate the migration.** Run: `bun run db:generate`. Expected: a new `drizzle/NNNN_*.sql` adding `call_overrides`. Inspect it — it must `CREATE TABLE "call_overrides"` with the FK to `creators` and the composite PK.
- [ ] **Step 3: Commit.** `git add db/schema.ts drizzle/ && git commit -m "feat(db): add call_overrides table"`

### Task 2: Pure `applyOverrides` transform

**Files:**

- Create: `pipeline/overrides.ts`
- Test: `pipeline/overrides.test.ts`

- [ ] **Step 1: Write the failing test** (`pipeline/overrides.test.ts`):

```ts
import { test, expect } from "bun:test";
import { applyOverrides, type Override } from "./overrides";
import type { ReelCall } from "../src/lib/types";

const base: ReelCall = {
  shortcode: "AAA",
  postDate: "2026-06-01",
  ticker: "DUOL",
  company: "Duolingo",
  direction: "bullish",
  isExplicitBuy: true,
  conviction: 0.9,
  quote: "q",
  onScreenPrice: null,
  summary: "s",
};

test("a non-null override field replaces the classified value; null fields are left alone", () => {
  const ov: Override[] = [
    {
      handle: "h",
      shortcode: "AAA",
      ticker: "AMD",
      isExplicitBuy: null,
      direction: null,
      reason: "wrong ticker",
    },
  ];
  const [c] = applyOverrides([base], ov);
  expect(c.ticker).toBe("AMD"); // overridden
  expect(c.isExplicitBuy).toBe(true); // untouched (null in override)
  expect(c.direction).toBe("bullish"); // untouched
});

test("override can flip isExplicitBuy off (the maintainable replacement for owner-DELETE)", () => {
  const ov: Override[] = [
    {
      handle: "h",
      shortcode: "AAA",
      ticker: null,
      isExplicitBuy: false,
      direction: null,
      reason: "not a buy",
    },
  ];
  expect(applyOverrides([base], ov)[0].isExplicitBuy).toBe(false);
});

test("calls with no override are returned unchanged; matching is by shortcode", () => {
  const ov: Override[] = [
    {
      handle: "h",
      shortcode: "ZZZ",
      ticker: "X",
      isExplicitBuy: null,
      direction: null,
      reason: "r",
    },
  ];
  expect(applyOverrides([base], ov)[0]).toEqual(base);
});

test("ticker is uppercased; an empty-string ticker override is ignored (treated as no-op)", () => {
  const ov: Override[] = [
    {
      handle: "h",
      shortcode: "AAA",
      ticker: "amd",
      isExplicitBuy: null,
      direction: null,
      reason: "r",
    },
  ];
  expect(applyOverrides([base], ov)[0].ticker).toBe("AMD");
});
```

- [ ] **Step 2: Run, verify it fails** (`bun test pipeline/overrides.test.ts`) — "Cannot find module './overrides'".
- [ ] **Step 3: Implement `pipeline/overrides.ts`:**

```ts
import type { ReelCall, Direction } from "../src/lib/types";

// A single operator correction. Null fields mean "leave the classified value".
export interface Override {
  handle: string;
  shortcode: string;
  ticker: string | null;
  isExplicitBuy: boolean | null;
  direction: string | null;
  reason: string;
}

const DIRECTIONS = new Set<Direction>(["bullish", "bearish", "neutral"]);

// Deterministic final pass over the classified calls. Pure (no IO) so it is trivially
// testable; score() supplies the overrides loaded from the DB. Matching is by shortcode
// (the call PK within a creator). A field is applied only when non-null and valid, so a
// partial override (e.g. just a ticker fix) leaves everything else as classified.
export function applyOverrides(calls: ReelCall[], overrides: Override[]): ReelCall[] {
  if (overrides.length === 0) return calls;
  const byCode = new Map(overrides.map((o) => [o.shortcode, o]));
  return calls.map((c) => {
    const o = byCode.get(c.shortcode);
    if (!o) return c;
    const ticker = o.ticker && o.ticker.trim() ? o.ticker.trim().toUpperCase() : c.ticker;
    const isExplicitBuy = o.isExplicitBuy ?? c.isExplicitBuy;
    const direction =
      o.direction && DIRECTIONS.has(o.direction as Direction)
        ? (o.direction as Direction)
        : c.direction;
    return { ...c, ticker, isExplicitBuy, direction };
  });
}
```

- [ ] **Step 4: Run, verify pass.** `bun test pipeline/overrides.test.ts` → 4 pass.
- [ ] **Step 5: Commit.** `git add pipeline/overrides.ts pipeline/overrides.test.ts && git commit -m "feat(pipeline): pure applyOverrides transform"`

### Task 3: Load overrides from the DB (isolated, fail-open)

**Files:**

- Create: `db/overrides.ts`
- Test: `db/overrides.test.ts` (env-gated, like the other `db/*.test.ts`)

- [ ] **Step 1: Write the failing env-gated test** (`db/overrides.test.ts`):

```ts
import { test, expect } from "bun:test";
import { makeDb } from "./client";
import { callOverrides, creators } from "./schema";
import { loadOverrides } from "./overrides";

const url = process.env.DATABASE_URL_INGEST_TEST;
const t = url ? test : test.skip; // skips when no test DB (keeps `bun test` green without a DB)

t("loadOverrides returns the rows for a handle, mapped to the Override shape", async () => {
  const db = makeDb(url!);
  await db.delete(callOverrides);
  await db
    .insert(creators)
    .values({
      handle: "h",
      name: "n",
      avatar: null,
      ord: 0,
      generatedAt: "2026-06-01",
      spyAnchor: "SPY",
      scorecard: {},
      caveats: [],
      indexStats: {},
    })
    .onConflictDoNothing();
  await db
    .insert(callOverrides)
    .values({
      handle: "h",
      shortcode: "AAA",
      ticker: "AMD",
      isExplicitBuy: null,
      direction: null,
      reason: "wrong ticker",
      createdAt: "2026-06-13",
    });
  const got = await loadOverrides(db, "h");
  expect(got).toEqual([
    {
      handle: "h",
      shortcode: "AAA",
      ticker: "AMD",
      isExplicitBuy: null,
      direction: null,
      reason: "wrong ticker",
    },
  ]);
});
```

- [ ] **Step 2: Run, verify it fails** (`bun test db/overrides.test.ts`) — "Cannot find module './overrides'" (or skips if no test DB; then verify by adding the file).
- [ ] **Step 3: Implement `db/overrides.ts`:**

```ts
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { callOverrides } from "./schema";
import type { Override } from "../pipeline/overrides";

// Read all overrides for a creator. Returns the pipeline Override shape (drops the
// createdAt audit column the transform doesn't need). Caller (score) is fail-open: a
// DB error there degrades to [] so scoring never breaks because overrides are down.
export async function loadOverrides(db: Db, handle: string): Promise<Override[]> {
  const rows = await db.select().from(callOverrides).where(eq(callOverrides.handle, handle));
  return rows.map((r) => ({
    handle: r.handle,
    shortcode: r.shortcode,
    ticker: r.ticker,
    isExplicitBuy: r.isExplicitBuy,
    direction: r.direction,
    reason: r.reason,
  }));
}
```

- [ ] **Step 4: Run, verify pass** (with `DATABASE_URL_INGEST_TEST` set) or confirm it skips cleanly without.
- [ ] **Step 5: Commit.** `git add db/overrides.ts db/overrides.test.ts && git commit -m "feat(db): loadOverrides reader"`

### Task 4: Wire overrides into `score()`

**Files:**

- Modify: `pipeline/score.ts` (the `score()` function only — `assembleDataset` stays pure)
- Test: `pipeline/score.test.ts` (add one test passing overrides through a seam)

The clean seam: `score()` loads overrides (fail-open) and applies them to `reelCalls` _before_ it builds the scope set and calls `assembleDataset`. Because `assembleDataset` already takes the calls array, the override transform slots in with no signature change to it.

- [ ] **Step 1: Add the imports to `pipeline/score.ts`** (top, with the other pipeline imports):

```ts
import { getWriteDb } from "../db/client";
import { loadOverrides } from "../db/overrides";
import { applyOverrides } from "./overrides";
```

- [ ] **Step 2: Apply overrides at the start of `score()`,** right after `reelCalls` is read:

```ts
const reelCalls: ReelCall[] = JSON.parse(
  await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"),
);
// Deterministic correction pass. Reads operator overrides from the DB (ingest role)
// and patches the classified calls before scoring, so the fix is baked identically
// into dataset.json AND (via backfill) the DB calls row. Fail-open: if the DB is
// unreachable, score still runs on the raw classification — corrections lag, scoring
// never breaks. Skipped entirely when no DB is configured (local/static runs).
let corrected = reelCalls;
if (process.env.DATABASE_URL_INGEST || process.env.DATABASE_URL) {
  try {
    const overrides = await loadOverrides(getWriteDb(), handle);
    if (overrides.length) {
      corrected = applyOverrides(reelCalls, overrides);
      console.log(`applied ${overrides.length} override(s) for ${handle}`);
    }
  } catch (e) {
    console.warn(
      `override load failed for ${handle} (scoring raw classification): ${(e as Error).message}`,
    );
  }
}
```

- [ ] **Step 3:** Replace the two later uses of `reelCalls` in `score()` with `corrected`: the `reelsWithTicker: reelCalls.length` count and the `assembleDataset(..., corrected, ...)` argument. (Leave the `reelsScraped` shortcodes read untouched.) Concretely the assembleDataset call becomes:

```ts
const ds = assembleDataset(
  { handle, name },
  corrected,
  ohlc,
  today,
  { reelsScraped, reelsWithTicker: corrected.length },
  postNoun,
  (sym) => !outOfScope.has(sym),
);
```

- [ ] **Step 4: Add a wiring test to `pipeline/score.test.ts`** proving the transform is the same one score uses (the DB read is covered in Task 3; here we assert the pure composition):

```ts
import { applyOverrides } from "./overrides";

test("applyOverrides feeds assembleDataset: an override flips a call out of scoring", () => {
  const reelCalls: ReelCall[] = [
    {
      shortcode: "a",
      postDate: "2026-06-01",
      ticker: "AAPL",
      company: "Apple",
      direction: "bullish",
      isExplicitBuy: true,
      conviction: 1,
      quote: "q",
      onScreenPrice: null,
      summary: "s",
    },
  ];
  const ohlc = { AAPL: [bar("2026-06-01", 100), bar("2026-06-08", 110)], SPY: spyBars };
  const corrected = applyOverrides(reelCalls, [
    {
      handle: "h",
      shortcode: "a",
      ticker: null,
      isExplicitBuy: false,
      direction: null,
      reason: "not a buy",
    },
  ]);
  expect(
    assembleDataset({ handle: "h", name: "n" }, corrected, ohlc, "2026-06-09").calls,
  ).toHaveLength(0);
});
```

- [ ] **Step 5: Run** `bun test pipeline/score.test.ts` (all pass) and `bunx tsc --noEmit` (clean).
- [ ] **Step 6: Commit.** `git add pipeline/score.ts pipeline/score.test.ts && git commit -m "feat(score): apply DB overrides as a deterministic pre-scoring pass (fail-open)"`

### Task 5: DB roles — ingest writes overrides, serve must not see them

**Files:**

- Modify: `scripts/apply-roles.ts`
- Test: extend the existing `serve-readonly`-style role test (find it: `db/serve-readonly.test.ts` or similar) with a `call_overrides` case.

- [ ] **Step 1: In `scripts/apply-roles.ts`,** after the `GRANT INSERT, UPDATE, SELECT ON artifacts TO ingest` line, add:

```ts
// Override store: ingest reads (score) + writes (apply-override.ts) it.
await sql`GRANT INSERT, UPDATE, SELECT ON call_overrides TO ingest`;
```

- [ ] **Step 2:** In the serve block, the serve role must NOT be granted `call_overrides`. The existing `ALTER DEFAULT PRIVILEGES ... REVOKE SELECT ... FROM serve` plus the explicit `GRANT SELECT ON creators, calls, prices, artifacts TO serve` (which deliberately omits `call_overrides`) already enforces this. Add an explicit defensive revoke to be unambiguous:

```ts
await sql`REVOKE ALL ON call_overrides FROM serve`;
```

- [ ] **Step 3:** Run migrations + roles against the test DB and assert serve cannot read overrides. Add to the role test:

```ts
t("serve role cannot read call_overrides", async () => {
  const serve = makeDb(process.env.DATABASE_URL_SERVE_TEST!);
  await expect(serve.select().from(callOverrides)).rejects.toThrow(/permission denied/i);
});
```

- [ ] **Step 4:** Run the env-gated role test (skips without `DATABASE_URL_SERVE_TEST`). Commit: `git add scripts/apply-roles.ts db/*role*.test.ts && git commit -m "feat(db): grant ingest call_overrides, deny serve"`

### Task 6: `scripts/apply-override.ts` operator CLI

**Files:**

- Create: `scripts/apply-override.ts`
- Modify: `package.json` (add `"override": "bun run scripts/apply-override.ts"` if a script alias is wanted; optional)

- [ ] **Step 1: Implement `scripts/apply-override.ts`:**

```ts
// Operator CLI: record a durable correction for one call, then tell the operator the
// re-score command. Writes call_overrides via the ingest role (getWriteDb). The override
// takes effect on the next score() for that creator (scripts/resume.ts already runs
// score → backfill → materialize → parity → revalidate).
//
// Usage:
//   bun run scripts/apply-override.ts <handle> <shortcode> --reason "<why>" \
//     [--ticker AMD] [--buy false] [--direction bullish]
import { getWriteDb } from "../db/client";
import { callOverrides } from "../db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [handle, shortcode] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const reason = arg("reason");
if (!handle || !shortcode || !reason) {
  console.error(
    'usage: apply-override.ts <handle> <shortcode> --reason "<why>" [--ticker X] [--buy true|false] [--direction bullish|bearish|neutral]',
  );
  process.exit(1);
}
const buyArg = arg("buy");
const isExplicitBuy = buyArg === undefined ? null : buyArg === "true";
const today = new Date().toISOString().slice(0, 10);

const db = getWriteDb();
await db
  .insert(callOverrides)
  .values({
    handle,
    shortcode,
    ticker: arg("ticker") ?? null,
    isExplicitBuy,
    direction: arg("direction") ?? null,
    reason,
    createdAt: today,
  })
  .onConflictDoUpdate({
    target: [callOverrides.handle, callOverrides.shortcode],
    set: {
      ticker: arg("ticker") ?? null,
      isExplicitBuy,
      direction: arg("direction") ?? null,
      reason,
      createdAt: today,
    },
  });
console.log(`override recorded for ${handle}/${shortcode}. Re-score to apply:`);
console.log(`  flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}`);
```

- [ ] **Step 2:** Manual verification (with a test/dev DB): run it for a known call, then `bun run scripts/resume.ts <handle>` (or just `score`), confirm the override applied (log line `applied N override(s)`), and `parity-check.ts <handle>` prints `PARITY OK`.
- [ ] **Step 3: Commit.** `git add scripts/apply-override.ts && git commit -m "feat(scripts): apply-override CLI"`

### Task 7: Parity — confirm overrides keep DB == static

**Files:**

- Modify: `scripts/parity-check.ts` only if it enumerates tables (it should NOT include `call_overrides`/`call_reports` — they are inputs/operational, not scored output). Verify, don't add.

- [ ] **Step 1:** Read `scripts/parity-check.ts`. Confirm it compares index, datasets, price symbols, and the calls-index artifact — and does NOT assert anything about `call_overrides`. The override's _effect_ is already in `calls`/`dataset.json` (both written from the same `corrected` array), so parity holds automatically. No code change expected.
- [ ] **Step 2:** Integration check: with an override present, run `score → backfill → materialize → parity-check` for that creator. Expected: `PARITY OK` (the corrected call matches in both static `dataset.json` and the DB reassembly).
- [ ] **Step 3:** If parity _fails_, the cause is a code path writing one side without the override — fix that path, do not special-case parity. Commit any doc note: `git commit -am "docs: note overrides are parity-neutral (effect lives in calls)"` (only if a comment was added).

### Task 8: Wire `REVALIDATE_TOKEN` for minutes-not-6h propagation

**Files:**

- Modify: `ops/README.md` (mark the token as required, not optional), `.env.example`
- No app code change — `scripts/revalidate-creator.ts` and the Nitro bypass are already wired; this is config + verification.

- [ ] **Step 1:** Generate a token: `openssl rand -base64 32 | tr -d '/+=' | head -c 40`.
- [ ] **Step 2:** Set `REVALIDATE_TOKEN` to that value in **Vercel production env** (so the build bakes it into each ISR route's `.prerender-config.json`) and trigger one redeploy.
- [ ] **Step 3:** Set the _identical_ value in the VM `.env`.
- [ ] **Step 4:** Verify: after a `resume.ts <handle>` run, confirm `revalidate-creator.ts` logs the GETs firing (not the "REVALIDATE_TOKEN unset — skipping" branch) and the creator page reflects a change within ~1 min instead of 6h.
- [ ] **Step 5:** Update `ops/README.md` to move `REVALIDATE_TOKEN` from "optional" to "required for instant propagation", and `.env.example`. Commit: `git add ops/README.md .env.example && git commit -m "docs(ops): require REVALIDATE_TOKEN for on-demand revalidation"`

---

## Phase 2 — Public report pipeline (signal layer)

Phase 2 feeds Phase 1: it tells the operator _which_ calls to look at. Independently testable (the endpoint + queue work regardless of whether any override is ever written).

### Task 9: `call_reports` schema + migration

**Files:**

- Modify: `db/schema.ts`
- Generate: migration

- [ ] **Step 1: Append to `db/schema.ts`:**

```ts
// One row per (call, reporter) flag from the public "Report incorrect" control. FK to
// calls so a report for a non-existent call is rejected at the DB without the report
// role needing SELECT. The unique (handle, shortcode, reporterHash) dedupe bounds spam
// to one report per reporter per call (onConflictDoNothing). reporterHash is a salted,
// non-reversible hash of the client IP (see src/routes/api/report.ts) — operational
// dedupe only, never displayed. reason is a closed enum (validated at the endpoint).
// Serve role must NOT see this table.
export const callReports = pgTable(
  "call_reports",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    handle: text("handle").notNull(),
    shortcode: text("shortcode").notNull(),
    reason: text("reason").notNull(), // enum: wrong-ticker|not-a-buy|wrong-direction|not-a-call|other
    reporterHash: text("reporter_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.handle, t.shortcode],
      foreignColumns: [calls.handle, calls.shortcode],
    }).onDelete("cascade"),
    uniqueIndex("call_reports_dedupe_idx").on(t.handle, t.shortcode, t.reporterHash),
    index("call_reports_call_idx").on(t.handle, t.shortcode),
  ],
);
```

Add `foreignKey, uniqueIndex` to the existing `drizzle-orm/pg-core` import line at the top of `db/schema.ts`.

- [ ] **Step 2:** `bun run db:generate`; inspect the migration for the FK to `calls`, the unique index, and the identity PK.
- [ ] **Step 3: Commit.** `git add db/schema.ts drizzle/ && git commit -m "feat(db): add call_reports table"`

### Task 10: `report` DB role (INSERT-only) + serve denial

**Files:**

- Modify: `scripts/apply-roles.ts`, `.env.example`, `ops/README.md`
- Test: extend the role test.

- [ ] **Step 1: In `scripts/apply-roles.ts`,** add a third role after the serve block:

```ts
const reportPw = process.env.REPORT_ROLE_PASSWORD!;
if (!SAFE_PW.test(reportPw)) {
  throw new Error("REPORT_ROLE_PASSWORD must be >=16 chars of [A-Za-z0-9_-]");
}
await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'report') THEN
      CREATE ROLE report LOGIN;
    END IF;
  END $$`;
await sql.query(`ALTER ROLE report PASSWORD '${reportPw.replaceAll("'", "''")}'`);
// INSERT-only on call_reports, nothing else. A compromised public endpoint can neither
// read the ledger nor the reports (no SELECT) nor write any other table.
await sql`GRANT INSERT ON call_reports TO report`;
await sql`REVOKE SELECT, UPDATE, DELETE ON call_reports FROM report`;
// ingest reads the queue (review-reports.ts); serve sees nothing.
await sql`GRANT SELECT ON call_reports TO ingest`;
await sql`REVOKE ALL ON call_reports FROM serve`;
console.log("report role configured: INSERT-only on call_reports.");
```

Note: `GRANT INSERT` on a table with an identity PK also needs `USAGE` on the implicit sequence; Postgres identity columns handle this via the table grant on modern PG, but if inserts fail with a sequence permission error, add `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO report`.

- [ ] **Step 2:** Add `REPORT_ROLE_PASSWORD` and `DATABASE_URL_REPORT` + `REPORT_SALT` to `.env.example` and `ops/README.md` with one-line descriptions (`DATABASE_URL_REPORT` = the report-role connection string used by `/api/report`; `REPORT_SALT` = random ≥16 chars, salts the IP dedupe hash).
- [ ] **Step 3:** Role test additions:

```ts
t("report role can INSERT but not SELECT call_reports", async () => {
  const report = makeDb(process.env.DATABASE_URL_REPORT_TEST!);
  await expect(report.select().from(callReports)).rejects.toThrow(/permission denied/i);
});
t("serve role cannot read call_reports", async () => {
  const serve = makeDb(process.env.DATABASE_URL_SERVE_TEST!);
  await expect(serve.select().from(callReports)).rejects.toThrow(/permission denied/i);
});
```

- [ ] **Step 4: Commit.** `git add scripts/apply-roles.ts .env.example ops/README.md db/*role*.test.ts && git commit -m "feat(db): INSERT-only report role; serve denied call_reports"`

### Task 11: `db/reports.ts` — insert + queue read

**Files:**

- Create: `db/reports.ts`
- Test: `db/reports.test.ts` (env-gated)

- [ ] **Step 1: Failing test** (`db/reports.test.ts`):

```ts
import { test, expect } from "bun:test";
import { makeDb } from "./client";
import { callReports, calls, creators } from "./schema";
import { insertReport, reportQueue, REPORT_REASONS } from "./reports";

const url = process.env.DATABASE_URL_INGEST_TEST;
const t = url ? test : test.skip;

t("insertReport dedupes by (handle, shortcode, reporterHash); queue counts compound", async () => {
  const db = makeDb(url!);
  await db.delete(callReports);
  await db
    .insert(creators)
    .values({
      handle: "h",
      name: "n",
      avatar: null,
      ord: 0,
      generatedAt: "x",
      spyAnchor: "SPY",
      scorecard: {},
      caveats: [],
      indexStats: {},
    })
    .onConflictDoNothing();
  await db
    .insert(calls)
    .values({
      handle: "h",
      shortcode: "AAA",
      ord: 0,
      postDate: "2026-06-01",
      ticker: "DUOL",
      company: "Duolingo",
      isFirstCall: true,
      conviction: 1,
      quote: "q",
      summary: "s",
      onScreenPrice: null,
      spark: null,
      returns: {},
    })
    .onConflictDoNothing();
  await insertReport(db, {
    handle: "h",
    shortcode: "AAA",
    reason: "wrong-ticker",
    reporterHash: "r1",
    createdAt: "2026-06-13",
  });
  await insertReport(db, {
    handle: "h",
    shortcode: "AAA",
    reason: "wrong-ticker",
    reporterHash: "r1",
    createdAt: "2026-06-13",
  }); // dup → ignored
  await insertReport(db, {
    handle: "h",
    shortcode: "AAA",
    reason: "not-a-buy",
    reporterHash: "r2",
    createdAt: "2026-06-13",
  });
  const q = await reportQueue(db);
  expect(q[0]).toMatchObject({ handle: "h", shortcode: "AAA", count: 2 });
});

t("REPORT_REASONS is the closed enum the endpoint validates against", () => {
  expect(REPORT_REASONS).toContain("wrong-ticker");
});
```

- [ ] **Step 2: Implement `db/reports.ts`:**

```ts
import { sql, eq } from "drizzle-orm";
import type { Db } from "./client";
import { callReports } from "./schema";

export const REPORT_REASONS = [
  "wrong-ticker",
  "not-a-buy",
  "wrong-direction",
  "not-a-call",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportRow {
  handle: string;
  shortcode: string;
  reason: string;
  reporterHash: string;
  createdAt: string;
}

// Insert one report; the unique (handle, shortcode, reporterHash) index makes a repeat
// from the same reporter a no-op. Called through the INSERT-only report role.
export async function insertReport(db: Db, r: ReportRow): Promise<void> {
  await db.insert(callReports).values(r).onConflictDoNothing();
}

// Operator review queue: one row per reported call, ranked by distinct-reporter count,
// with the reasons seen. Read through ingest (has SELECT). Plain SQL aggregate.
export async function reportQueue(
  db: Db,
): Promise<{ handle: string; shortcode: string; count: number; reasons: string[] }[]> {
  const rows = await db
    .select({
      handle: callReports.handle,
      shortcode: callReports.shortcode,
      count: sql<number>`count(*)::int`,
      reasons: sql<string[]>`array_agg(distinct ${callReports.reason})`,
    })
    .from(callReports)
    .groupBy(callReports.handle, callReports.shortcode)
    .orderBy(sql`count(*) desc`);
  return rows;
}
```

- [ ] **Step 3:** Run the env-gated test (set `DATABASE_URL_INGEST_TEST`), verify pass / clean skip. Commit: `git add db/reports.ts db/reports.test.ts && git commit -m "feat(db): report insert + compounding review queue"`

### Task 12: Public `/api/report` POST endpoint

**Files:**

- Create: `src/routes/api/report.ts`
- Test: `src/routes/api/report.test.ts`
- Verify: `vite.config.ts` `routeRules` — a POST is not ISR-cached, but confirm `/api/report` is not forced static.

- [ ] **Step 1: Failing test** (`src/routes/api/report.test.ts`) — validation logic, no DB:

```ts
import { test, expect } from "bun:test";
import { validateReportBody, reporterHashOf } from "./report";

test("rejects unknown reason and missing fields", () => {
  expect(validateReportBody({ handle: "h", shortcode: "a", reason: "spam" })).toBeNull();
  expect(validateReportBody({ handle: "h", reason: "other" })).toBeNull();
  expect(validateReportBody({ handle: "h", shortcode: "a", reason: "other" })).toEqual({
    handle: "h",
    shortcode: "a",
    reason: "other",
  });
});

test("over-long handle/shortcode rejected (bound the write)", () => {
  expect(
    validateReportBody({ handle: "x".repeat(200), shortcode: "a", reason: "other" }),
  ).toBeNull();
});

test("reporterHash is stable for same ip+salt, differs across salts, and leaks no raw ip", () => {
  const a = reporterHashOf("1.2.3.4", "salt1");
  expect(reporterHashOf("1.2.3.4", "salt1")).toBe(a);
  expect(reporterHashOf("1.2.3.4", "salt2")).not.toBe(a);
  expect(a).not.toContain("1.2.3.4");
});
```

- [ ] **Step 2: Implement `src/routes/api/report.ts`:**

```ts
import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { makeDb } from "../../../db/client";
import { insertReport, REPORT_REASONS } from "../../../db/reports";

export interface ReportInput {
  handle: string;
  shortcode: string;
  reason: string;
}

// Validate the public body: closed reason enum, present + length-bounded ids. Returns the
// clean input or null (→ 400). No free text, so no PII / stored-XSS surface.
export function validateReportBody(body: unknown): ReportInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const { handle, shortcode, reason } = b;
  if (typeof handle !== "string" || handle.length < 1 || handle.length > 64) return null;
  if (typeof shortcode !== "string" || shortcode.length < 1 || shortcode.length > 64) return null;
  if (typeof reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(reason))
    return null;
  return { handle, shortcode, reason };
}

// Non-reversible, salted hash of the client IP — operational dedupe only, never stored raw
// or displayed. Empty/unknown IP still hashes (all such reporters share one bucket).
export function reporterHashOf(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0]!.trim() : "") || req.headers.get("x-real-ip") || "";
}

export const Route = createFileRoute("/api/report")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const url = process.env.DATABASE_URL_REPORT;
        const salt = process.env.REPORT_SALT;
        if (!url || !salt)
          return Response.json({ error: "reporting not configured" }, { status: 503 });
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad body" }, { status: 400 });
        }
        const input = validateReportBody(body);
        if (!input) return Response.json({ error: "invalid report" }, { status: 400 });
        try {
          await insertReport(makeDb(url), {
            ...input,
            reporterHash: reporterHashOf(clientIp(request), salt),
            createdAt: new Date().toISOString().slice(0, 10),
          });
        } catch (e) {
          // FK violation = report for a non-existent call → 404; anything else → 500.
          const msg = (e as Error).message;
          if (/foreign key/i.test(msg))
            return Response.json({ error: "unknown call" }, { status: 404 });
          console.error("[report] insert failed:", msg);
          return Response.json({ error: "could not record report" }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
```

- [ ] **Step 3:** Run `bun test src/routes/api/report.test.ts` (3 pass) and `bunx tsc --noEmit`.
- [ ] **Step 4:** Confirm in `vite.config.ts` that `routeRules` does not force `/api/report` to a cached/prerendered entry (the `/api/*` swr rule applies to GET responses; a POST is uncached by Vercel). If a catch-all prerender rule would capture it, add `'/api/report': { swr: false }` (or equivalent) so the mutation always hits the function.
- [ ] **Step 5: Commit.** `git add src/routes/api/report.ts src/routes/api/report.test.ts vite.config.ts && git commit -m "feat(api): public /api/report endpoint (enum-validated, salted-hash dedupe, report role)"`

### Task 13: `scripts/review-reports.ts` operator queue

**Files:**

- Create: `scripts/review-reports.ts`

- [ ] **Step 1: Implement:**

```ts
// Operator review queue: print reported calls ranked by distinct-reporter count, joined
// with the call's current ticker/quote so the operator can decide on an override. Reads
// via the ingest role (getWriteDb). Run over SSH on the VM, or locally against prod.
import { getWriteDb } from "../db/client";
import { reportQueue } from "../db/reports";
import { calls } from "../db/schema";
import { and, eq } from "drizzle-orm";

const db = getWriteDb();
const q = await reportQueue(db);
if (!q.length) {
  console.log("no reports.");
  process.exit(0);
}
for (const r of q) {
  const [call] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.handle, r.handle), eq(calls.shortcode, r.shortcode)));
  console.log(`\n[${r.count}] ${r.handle}/${r.shortcode}  reasons: ${r.reasons.join(", ")}`);
  if (call)
    console.log(`    current: ${call.ticker} buy=${call.isFirstCall} "${call.quote.slice(0, 80)}"`);
  console.log(
    `    fix: bun run scripts/apply-override.ts ${r.handle} ${r.shortcode} --reason "..." [--ticker X] [--buy false]`,
  );
}
```

- [ ] **Step 2:** Manual verify against a DB with reports. Commit: `git add scripts/review-reports.ts && git commit -m "feat(scripts): review-reports operator queue"`

### Task 14: "Report incorrect" control in the proof drawer

**Files:**

- Modify: `src/components/proof-viewer.tsx` (add the control to `ProofContent`; thread `handle`)
- Modify: the two `ProofViewer` call sites to pass `handle` (creator route param on `/c/$handle`; per-call `handle` on the ticker page's calls-index entries)
- Create: `src/components/report-button.tsx`
- Test: `src/components/report-button.test.tsx` (reason→POST body shape; reuse `validateReportBody` as the contract)

- [ ] **Step 1:** Thread `handle` into `ProofViewer` and `ProofContent`. Change the signatures to `ProofViewer({ call, handle, onClose })` and `ProofContent({ call, handle })`, and pass `handle` at both render sites inside `ProofViewer`.

- [ ] **Step 2: Create `src/components/report-button.tsx`** — a small control rendering the reason enum and POSTing, with optimistic success + per-shortcode localStorage so a reporter can't spam from the UI:

```tsx
import { useState } from "react";
import { REPORT_REASONS } from "#/../db/reports.ts"; // type-only enum reuse; adjust path to alias

const LABELS: Record<string, string> = {
  "wrong-ticker": "Wrong ticker",
  "not-a-buy": "Not a buy call",
  "wrong-direction": "Wrong direction",
  "not-a-call": "Not a stock call",
  other: "Something else",
};

export function ReportButton({ handle, shortcode }: { handle: string; shortcode: string }) {
  const key = `reported:${shortcode}`;
  const already = typeof localStorage !== "undefined" && localStorage.getItem(key) === "1";
  const [state, setState] = useState<"idle" | "open" | "sent">(already ? "sent" : "idle");

  async function send(reason: string) {
    setState("sent");
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    try {
      await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, shortcode, reason }),
      });
    } catch {
      /* best-effort; UI already thanked the user */
    }
  }

  if (state === "sent")
    return <p className="text-[11px] text-muted-foreground">Thanks — flagged for review.</p>;
  if (state === "idle")
    return (
      <button
        onClick={() => setState("open")}
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Report incorrect
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted-foreground">Why?</span>
      {REPORT_REASONS.map((r) => (
        <button
          key={r}
          onClick={() => send(r)}
          className="rounded-md border border-border/60 px-2 py-1 text-[11px] hover:bg-muted"
        >
          {LABELS[r] ?? r}
        </button>
      ))}
    </div>
  );
}
```

Note: import the enum without pulling server code into the client bundle — if `db/reports.ts` imports drizzle, define `REPORT_REASONS` in a tiny shared `src/lib/report-reasons.ts` and import it from both `db/reports.ts` and here. Prefer that split to keep neon/drizzle out of the client.

- [ ] **Step 2a: Create `src/lib/report-reasons.ts`** with just `export const REPORT_REASONS = [...] as const;` and import it into both `db/reports.ts` and `report-button.tsx`. Adjust Task 11 to import from here.

- [ ] **Step 3:** Render `<ReportButton handle={handle} shortcode={call.shortcode} />` at the bottom of `ProofContent`'s left column (under the Quote block), so it appears in both the desktop dialog and the mobile drawer.

- [ ] **Step 4:** Test the contract (`report-button.test.tsx`): assert the body the button would POST passes `validateReportBody` for each enum reason. (Keep it a unit test of the payload shape; full DOM testing is optional given the small surface.)

- [ ] **Step 5:** `bunx tsc --noEmit` clean; `bun test`. Commit: `git add src/components/report-button.tsx src/lib/report-reasons.ts src/components/proof-viewer.tsx src/routes/**/*.tsx && git commit -m "feat(ui): Report incorrect control in proof drawer"`

### Task 15: Document the loop in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1:** Add a "Correction loop" subsection near the scoring/Plan-1 docs covering: the report → review → override → re-score → revalidate flow; the three-way role split (serve SELECT-only and blind to `call_overrides`/`call_reports`; ingest reads/writes overrides + reads reports; report INSERT-only on reports); that overrides apply at score-time so they are parity-neutral (effect lives in `calls`); the enum-only, never-displayed report reasons; and that `REVALIDATE_TOKEN` must be set for instant propagation.
- [ ] **Step 2:** Note the cutover step: after deploy, run `bun run db:migrate && bun run db:roles` (now creates the `report` role too) and set `DATABASE_URL_REPORT` + `REPORT_SALT` in Vercel prod.
- [ ] **Step 3: Commit.** `git add CLAUDE.md && git commit -m "docs: document the report→override correction loop"`

---

## Self-Review

**Spec coverage:**

- Public report from the drawer → Tasks 9–14. ✓
- Reports compound (accumulate, ranked) → `reportQueue` (Task 11), review script (Task 13). ✓
- Durable override surviving re-extract/backfill/git-checkout → DB table + score-time apply (Tasks 1–4). ✓
- Auto-propagation to live site → `REVALIDATE_TOKEN` (Task 8) + existing `revalidate-creator.ts`. ✓
- Least-privilege / abuse surface → report role INSERT-only, enum reasons, salted-hash dedupe, FK validation (Tasks 10, 12). ✓
- Parity preserved → Task 7. ✓

**Type consistency:** `Override` defined in `pipeline/overrides.ts` (Task 2), consumed by `loadOverrides` (Task 3) and `applyOverrides` in `score()` (Task 4). `REPORT_REASONS` defined once in `src/lib/report-reasons.ts` (Task 14 Step 2a), consumed by `db/reports.ts` and the endpoint and the UI. `ReportRow` (Task 11) matches the `insertReport` call in the endpoint (Task 12). `validateReportBody`/`reporterHashOf` defined in `report.ts` (Task 12), reused by the UI contract test (Task 14).

**Open items deferred (tracked, not silently dropped):**

- Cross-IP rate limiting beyond per-reporter dedupe (Vercel KV is retired; revisit with Upstash or a DB counter if spam appears). The unique-index dedupe is the v1 control.
- A web review UI (vs the `review-reports.ts` script) — the queue read (`reportQueue`) is reusable when that's built.
- Classifier-quality residual (DUOL↔AMD, HIMS FN) remains the separate Workstream A; this loop _corrects_ such errors but does not _prevent_ them.
