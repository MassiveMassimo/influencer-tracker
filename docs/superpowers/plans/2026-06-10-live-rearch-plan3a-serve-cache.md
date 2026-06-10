# Plan 3a — Serve Freshness + CDN Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live `USE_DB=1` serve path fast and *consistent across hard-load and client-navigation*, so a DB update is reflected everywhere within a bounded TTL **without a redeploy** — closing the split-brain gap (review H2) that today still ties freshness to deploys.

**Architecture:** Replace the client-side static-asset fetches (`/datasets/*.json`, `/prices/*.json`, `/calls-index.json`) with **GET API routes** (`/api/dataset/$handle`, `/api/prices/$symbol`, `/api/calls-index`) that read DB→static-fallback through the existing seam, and cache those routes at Vercel's CDN via Nitro `routeRules` (`swr`, TTL 6h). Page routes also get `swr` route rules so SSR HTML is edge-cached. Both SSR and client navigation now read the *same* DB-backed, CDN-cached source — no more static/DB divergence. Static assets remain as the panic fallback. Invalidation in this plan is the TTL backstop plus a manual purge route; ingest-triggered purge is wired in Plan 3b.

**Tech Stack:** TanStack Start server routes (file-based API routes), Nitro `routeRules` (`swr`) → Vercel CDN, `@neondatabase/serverless` neon-http (serve role), `bun test`, `bunx tsc --noEmit`. `#/` → `src/`.

**Scope boundary (YAGNI):** No VM/ingest, no two-tier LLM gate (Plans 3b/4). No KV/Upstash store (CDN route caching only — the approved mechanism). Cache *invalidation on ingest* is Plan 3b; this plan provides the TTL backstop and the purge seam.

**Carries review findings** from the 2026-06-10 holistic review: H2 (split-brain — this plan's core), M1 (require role URLs), M2 (artifact parity + `db:sync`), the over-broad `serve` default-privilege grant (revert to explicit), and the "data as of" staleness UI. H1 (prices restatement contract) is Task 7. M3 (call-deletion policy) is deferred to Plan 3b with an interim runbook note (Task 0).

---

### Task 0: Cutover hardening (review M1 + default-privilege revert)

Small, safety-first fixes for the now-live serve path.

**Files:**
- Modify: `db/client.ts`
- Modify: `scripts/apply-roles.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Require the least-privilege URLs under USE_DB; never silently escalate to owner**

In `db/client.ts`, replace `getDb`/`getWriteDb` so a missing role URL throws (the `catch` in `data.ts` then degrades to static AND logs — the throw is the alarm), instead of silently using the owner connection:

```ts
export function getDb(): Db {
  if (process.env.USE_DB === "1" && !process.env.DATABASE_URL_SERVE) {
    throw new Error("USE_DB=1 but DATABASE_URL_SERVE unset — refusing to serve as owner");
  }
  return (_db ??= makeDb(process.env.DATABASE_URL_SERVE ?? process.env.DATABASE_URL!));
}

export function getWriteDb(): Db {
  if (!process.env.DATABASE_URL_INGEST) {
    console.warn("DATABASE_URL_INGEST unset — writer running as owner (prices freeze not role-enforced)");
  }
  return makeDb(process.env.DATABASE_URL_INGEST ?? process.env.DATABASE_URL!);
}
```

- [ ] **Step 2: Revert the over-broad serve default privilege to explicit grants**

In `scripts/apply-roles.ts`, remove the `ALTER DEFAULT PRIVILEGES … GRANT SELECT … TO serve` line (Plan 4 adds tables the public role must not see — e.g. LLM-gate state). Keep the explicit `GRANT SELECT ON creators, calls, prices, artifacts TO serve`. Update the CLAUDE.md roles bullet: drop the "auto-grants SELECT on future tables" sentence; state that **`db:roles` must be re-run after any migration that adds a table** (both roles are now explicit-grant).

- [ ] **Step 3: Document the live operational invariant + the call-deletion runbook (review H2 interim, M3)**

In `CLAUDE.md` "Data source" section add: *"Until Plan 3a ships, client-side navigation reads build-time static assets, so every prod DB change must be accompanied by a redeploy or hard-load and client-nav diverge."* And, for M3: in `scripts/backfill.ts` the count-guard error message, append `" — a removed call needs owner-role DELETE on calls (ingest cannot); see Plan 3b deletion policy."`

- [ ] **Step 4: Typecheck + commit**

Run: `bunx tsc --noEmit` → expect 0. Commit: `fix(serve): require role URLs under USE_DB; explicit serve grants; live invariant docs`.

---

### Task 1: DB-or-static read helpers extracted (pure, testable)

The three fetchers each inline the `import.meta.env.SSR && serverUseDb()` DB branch + static fetch. The API routes (Task 2) need the **DB-or-throw** read without the static fetch. Extract the read decision so both the API route and the existing SSR fetchers share one path.

**Files:**
- Modify: `src/lib/data.ts`
- Test: `src/lib/data.test.ts` (create — the never-committed test from Plan 1; review LOW)

- [ ] **Step 1: Write the failing test for `readFromDbOrNull`**

```ts
// src/lib/data.test.ts
import { test, expect, describe } from "bun:test";
import { readFromDbOrNull } from "./data";

describe("readFromDbOrNull", () => {
  test("returns null when not SSR or USE_DB off (no DB import attempted)", async () => {
    // In bun test env import.meta.env.SSR is undefined and USE_DB unset → null, no throw.
    expect(await readFromDbOrNull(async () => "x")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it (fails — export missing)**

Run: `bun test src/lib/data.test.ts` → FAIL (`readFromDbOrNull` not exported).

- [ ] **Step 3: Add the helper**

In `src/lib/data.ts`, factor the gate into one function and use it in the three SSR fetchers:

```ts
// Runs the DB read only during SSR with USE_DB=1; returns null otherwise so callers fall
// back to the static/CDN path. The import.meta.env.SSR literal stays AT THE CALL SITE in
// each fetcher (Rollup DCE); this helper only wraps the runtime USE_DB check + error log.
export async function readFromDbOrNull<T>(read: () => Promise<T>): Promise<T | null> {
  if (typeof window !== "undefined" || process.env.USE_DB !== "1") return null;
  try {
    return await read();
  } catch (e) {
    console.error("DB read failed — falling back", e);
    return null;
  }
}
```

(Each fetcher keeps `if (import.meta.env.SSR && process.env.USE_DB === "1") { const r = await readFromDbOrNull(...); if (r != null) return r; }` so the literal still gates the dynamic `import("../../db/client")`.)

- [ ] **Step 4: Run test → PASS. Commit** `feat(data): extract readFromDbOrNull gate`.

---

### Task 2: GET API routes for dataset / prices / calls-index

**Files:**
- Create: `src/routes/api/dataset.$handle.ts`
- Create: `src/routes/api/prices.$symbol.ts`
- Create: `src/routes/api/calls-index.ts`
- Reference: existing server-route/loader patterns in `src/routes/`; `src/lib/data.ts` for the read+fallback logic.

Each route: under SSR+USE_DB read DB (via the dynamic `db-read` import, gated by the `import.meta.env.SSR` literal); on any miss/error fall back to fetching the committed static asset over HTTP via `siteUrl(...)` so the route is always-200. **Correction vs original draft:** NOT a `node:fs` disk read — on Vercel, `public/` ships to the CDN, not the serverless function's filesystem, so a `process.cwd()/public` read throws on prod. `data.ts` already fetches these assets via `siteUrl` during SSR; the route reuses that proven pattern. Return JSON with a `Cache-Control` header as a defensive backstop (routeRules in Task 3 is the primary cache).

- [ ] **Step 1:** Write each route handler reusing the DB-read functions (`readDataset`/`readPrices`/`readCallsIndex`) and, on null, fetching `siteUrl("/datasets/<h>.json")` etc. over HTTP — independent of `data.ts`'s fetchers (Task 4 repoints those at these routes; avoid circularity). (Server-only file — never imported by client code, so `db-read` import is safe.)
- [ ] **Step 2:** Verify locally with `USE_DB=0` (static path) then `USE_DB=1 DATABASE_URL_SERVE=… ` against the test branch: `bun run dev`, `curl localhost:3000/api/calls-index | jq length` → 893; `/api/dataset/TheProfInvestor` → full Dataset; `/api/prices/SPY` → OHLC array.
- [ ] **Step 3:** Add a route test asserting shape parses with the existing zod schemas (`DatasetSchema`, `PriceFileSchema`, `CallIndexSchema`).
- [ ] **Step 4: Commit** `feat(api): cached read routes for dataset/prices/calls-index`.

---

### Task 3: CDN caching via routeRules (the approved mechanism)

**Files:**
- Modify: `vite.config.ts` (`nitro.routeRules`)

- [ ] **Step 1: Add `swr` rules for the API + page routes**

```ts
routeRules: {
  // … existing '/' Link header + '/relay/**' proxy rules …
  '/api/dataset/**':  { swr: 21600 },   // 6h CDN cache, stale-while-revalidate
  '/api/prices/**':   { swr: 21600 },
  '/api/calls-index': { swr: 21600 },
  '/c/**':            { swr: 21600 },    // SSR HTML edge-cached (hard-load latency)
  '/t/**':            { swr: 21600 },
  '/explore':         { swr: 21600 },
}
```

(Keep the `/` rule's existing `headers`; `swr` can be added alongside. The `/relay/static/**` rule must stay first.)

- [ ] **Step 2: Verify the cache compiles to Vercel CDN**

Run `USE_DB=0 bunx vite build` and confirm `.vercel/output/config.json` contains the route overrides (no function invocation for cache hits). Document the expected `x-vercel-cache` HIT/STALE behavior in the task notes.

- [ ] **Step 3: Commit** `feat(cache): 6h swr CDN rules for serve routes`.

---

### Task 4: Client fetchers read the cached API routes (review H2 fix)

**Files:**
- Modify: `src/lib/data.ts`

- [ ] **Step 1:** Change the client/non-SSR branch of `fetchDataset`/`fetchPrices`/`fetchCallsIndex` to fetch `/api/dataset/${handle}` / `/api/prices/${symbol}` / `/api/calls-index` (relative on client, `siteUrl()` on SSR) **instead of** the static `/datasets|prices|calls-index` assets. Keep the static asset read as a final `catch` fallback so a cold/broken API route still serves something.
- [ ] **Step 2: Verify no split-brain:** `bun run build && bun run preview` (or a Vercel preview) with `USE_DB=1`; hard-load `/c/<h>` and client-navigate to it from `/` — assert identical `generatedAt`. Repeat for `/explore` (calls-index) vs `/c/<h>` (roster).
- [ ] **Step 3:** Re-grep the client bundle (`.vercel/output/static/assets`) for `neondatabase|drizzle|DATABASE_URL` → expect zero (the API routes are server-only; the client only `fetch()`es URLs).
- [ ] **Step 4: Commit** `fix(data): client reads cached API routes, not deploy-frozen static (review H2)`.

---

### Task 5: "Data as of" staleness UI

**Files:**
- Modify: a shared layout/footer component (e.g. the creator-page header or `WorkspaceRail`); reuse `Dataset.generatedAt` / the artifact `generatedAt`.

- [ ] **Step 1:** Render a subtle "Data as of <relative time>" from `generatedAt` on the creator and explore pages, so a cached-but-stale view is visible (TTL ≤6h means up to 6h stale is expected).
- [ ] **Step 2:** Snapshot/unit test the relative-time formatting (reuse existing `format.ts` if present).
- [ ] **Step 3: Commit** `feat(ui): data-as-of staleness indicator`.

---

### Task 6: Parity covers the artifact + `db:sync` chains backfill→materialize (review M2)

**Files:**
- Modify: `scripts/parity-check.ts`
- Modify: `package.json` (add `db:sync`)

- [ ] **Step 1:** In `parity-check.ts`, after the prices loop, reassemble `buildCallsIndex(await Promise.all(index.map(e => readDataset(db, e.handle))))` and deep-equal it against `readCallsIndex(db)`; throw `artifact parity FAILED` on mismatch. (Closes the "/explore drifts vs /c/$handle" gap.)
- [ ] **Step 2:** Add `"db:sync": "bun run db:backfill && bun run db:materialize"` to `package.json` scripts so backfill can't be run without re-materializing the artifact.
- [ ] **Step 3:** Update the CLAUDE.md cutover sequence to use `db:sync`. Run `parity-check` against the test branch → expect `PARITY OK` incl. the new artifact line.
- [ ] **Step 4: Commit** `feat(db): artifact parity + db:sync (review M2)`.

---

### Task 7: Reconcile the frozen-prices restatement contract (review H1)

**Files:**
- Modify: `src/lib/prices-merge.ts`
- Modify: `db/backfill.ts` (collision detection)
- Modify: `CLAUDE.md` (restatement runbook)

- [ ] **Step 1: Write the failing test** for an insert-only merge (existing wins on collision, matching the DB's `onConflictDoNothing`), so a Yahoo restatement can't silently rewrite the shared store out of sync with the frozen DB:

```ts
// existing date keeps its old OHLC; only genuinely-new dates are added
expect(mergePrices([{date:"2026-01-02",o:1,h:1,l:1,c:1}], [{date:"2026-01-02",o:2,h:2,l:2,c:2}]))
  .toEqual([{date:"2026-01-02",o:1,h:1,l:1,c:1}]);
```

- [ ] **Step 2:** Flip `prices-merge.ts` to existing-wins. In `db/backfill.ts` `backfillPrices`, detect a collision whose values *differ* and `console.warn` it (so an intentional restatement is visible, not silently dropped) instead of bare `onConflictDoNothing`.
- [ ] **Step 3:** Add a CLAUDE.md runbook: an intentional split/dividend restatement is an owner-role operation (`UPDATE prices …` as owner) followed by re-running the per-creator `score` and `parity-check`; the ingest/serve roles deliberately cannot do it.
- [ ] **Step 4: Run tests → PASS. Commit** `fix(prices): insert-only shared-store merge matches frozen DB (review H1)`.

---

### Task 8: Manual revalidation/purge seam (for Plan 3b)

**Files:**
- Create: `src/routes/api/revalidate.ts` (POST, token-guarded)

- [ ] **Step 1:** A POST route that, given a secret token (`REVALIDATE_TOKEN` env) and a list of paths/tags, calls Vercel's purge for those CDN entries — the hook ingest will call in Plan 3b. In 3a it's operator-callable + tested for auth rejection only (no ingest yet).
- [ ] **Step 2:** Test: missing/wrong token → 401. Commit `feat(api): token-guarded revalidate seam for Plan 3b`.

---

## Self-Review

- **Spec coverage:** caching (Tasks 2–3), client-nav freshness / H2 (Tasks 1, 4), "data as of" (Task 5), TTL backstop (Task 3), purge seam (Task 8) — all map to the spec's Vercel lifecycle ("serve precomputed artifacts, TTL ≤6h backstop, bust tags"). Ingest-triggered bust is correctly deferred to 3b.
- **Review findings:** H2 (Tasks 1+4), M1 (Task 0), M2 (Task 6), default-priv revert (Task 0), data-as-of (Task 5), H1 (Task 7), M3 (Task 0 interim note). Covered.
- **Bundle invariant:** Task 4 Step 3 re-greps the client bundle; API routes are server-only files, so the neon import stays server-side.
- **Type/name consistency:** `readFromDbOrNull`, `db:sync`, `/api/dataset/$handle` used consistently across tasks.
- **Open decision (flag at execution):** Task 7 picks existing-wins to match the DB; confirm with the user that intentional restatements as owner-surgery is acceptable vs. unfreezing the display store.

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, spec + quality review between tasks.
2. **Inline Execution** — batch with checkpoints.

Tasks 0, 6, 7 are independent and could go first (hardening); Tasks 1→2→3→4 are the ordered freshness/cache core; Tasks 5, 8 are independent.
