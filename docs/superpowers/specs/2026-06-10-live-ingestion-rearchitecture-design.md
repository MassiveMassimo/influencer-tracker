# Live Ingestion Re-Architecture — Design

> **PARTIALLY SUPERSEDED 2026-06-22.** The ingest ledger / correction-loop / frozen-pricing parts
> shipped and remain. The **serve-from-DB path (`USE_DB=1`) was reverted** — it exhausted Neon's
> free-tier 5 GB/mo egress (HTTP 402, compute suspended) and the project is unwilling to pay. The
> serve path is back on committed static assets (`USE_DB=0`); the DB is retained only for the
> correction loop, and the VM daily run commits+pushes `data/` for Vercel to auto-deploy. Read the
> "serve" sections below as a dormant design, not current behavior. Current state: root `CLAUDE.md`
> "Data source" REVERTED banner.

**Date:** 2026-06-10
**Status:** Approved (design); serve-from-DB layer reverted 2026-06-22 (see banner)
**Supersedes:** the static-git-baked dataset model and the "no DB / cron-roadmap" assumption recorded in prior memory. Scope changed: the site is now meant to be **live, public, performant, and continuously fresh**, with a growing creator roster and rich cross-creator features.

## Goal

Make the dashboard always-up-to-date **without redeploys**, fast under public traffic, and able to serve cross-creator features (leaderboard, search, cross-creator ticker view, interactive filter/sort over all calls) — while preserving the project's reproducible, frozen forward-return scoring.

## Non-goals

- Real-time / sub-minute call updates. Calls ingest ~4×/day (X) and ~1×/day (IG). Price charts remain live from Yahoo (unchanged).
- User accounts / per-user state on the public site. Read-only public app.
- Server-side full-text search at launch (deferred until measured need).

## Scale assumptions

- Roster: tens (10–50) creators over ~1 year. Today: 2 creators, ~893 calls.
- Call corpus: sub-50k rows for the foreseeable future (50 creators × low-thousands).
- This row count is the load-bearing assumption behind the serve design. If the corpus crosses ~50k rows or quote/summary full-text search becomes a requirement, revisit the serve path (see "Future: server-side query path").

## Core principle: materialize at ingest, serve cheap

Data changes 4×/day. Therefore compute read views **once, at ingest**, and serve them as cheap cached artifacts — do **not** run live SQL per request and try to cache it. Live faceted queries have combinatorial cache-key cardinality (every filter/sort/page combo is a distinct, mostly-cold key), which would make the DB a latency, cost, and DoS liability on exactly the endpoint that motivated it.

**Postgres is the ingest ledger and source of truth, not the per-request query engine.** Its job is durable cursors, idempotent upserts, the review queue, the reject audit trail, immutable price storage, and concurrent-safe writes. The serve path reads precomputed artifacts.

## Architecture — three decoupled lifecycles

```
┌─ imos-vm (cron) ───────────────────────┐   ┌─ Neon Postgres ─────┐   ┌─ Vercel ──────────────────┐
│ scrape (X ~6h / IG ~1×day + jitter)    │   │ LEDGER:             │   │ serve PRECOMPUTED artifacts│
│  → extract T1 ×2, escalate on disagree │   │  creators, calls    │   │  • slim calls-index (1 tag)│
│  → frontier judge (capped)             │──►│  cursors, review_q  │──►│  • leaderboard, scorecards │
│  → price (insert-only) → score (frozen)│   │  reject_audit       │   │  • per-creator payloads    │
│  → materialize artifacts → write DB    │   │  prices (immutable) │   │ client-side filter/sort    │
│  → render new OG → Blob                │   │  PITR + dumps backup│   │ TTL ≤6h backstop on caches │
│  → bust tags (retried) → warm routes   │   └─────────────────────┘   └────────────────────────────┘
└────────────────────────────────────────┘
         dead-man-switch + "data as of" staleness surfaced in the UI
```

### 1. Ingest — imos-vm, cron, batch

Stays on the VM because IG scraping needs Playwright headful + persistent browser profile + yt-dlp + Whisper — none of which run on Vercel functions.

- **Cadence:** X ~6-hourly; **IG ~1×/day with jitter** (IG posts less and punishes frequent automated access; do not let X's cadence set IG's ban risk).
- **Incremental:** scrape only new posts. Per-creator, per-source cursors (last-seen post id) live **in Postgres**, not VM disk, so a re-provisioned VM resumes cleanly.
- **Idempotent:** all writes are upserts keyed by `shortcode`. A crashed/retried run never double-writes.
- **Two-tier extraction** (replaces the human review gate):
  - **T1 (bulk):** cheap fast model extracts every post — run **twice** (or as a cheap pair) at temp > 0.
  - **Escalate on disagreement:** if `ticker` / `direction` / `isExplicitBuy` mismatch between the two T1 runs, escalate to a **frontier judge** (stronger model). Do **not** gate on `conviction` — that is the creator's conviction in the call, orthogonal to the model's confidence in the extraction.
  - **Judge decision:** confirm → publish; reject → persist **flagged in `reject_audit`** (never silently dropped); genuinely ambiguous → `review_queue` for async human clearing.
  - **Cost cap:** bound escalations per run; alert if the escalation rate spikes (a miscalibrated gate can silently escalate everything).
  - **Calibration:** before going unattended, measure T1 precision/recall against the **golden set** of human-reviewed calls from the current era. Run the gate in **shadow mode** (LLM decides, human still confirms) for a few weeks first.
  - **Bias toward escalation:** the site publicly scores named individuals; a false "X said buy Y" is a reputational/defamation-adjacent risk, a dropped call is just a missed data point. Asymmetric cost → asymmetric gate.
- **Pricing:** Yahoo daily OHLC, **insert-only** (see Frozen scoring).
- **Scoring:** forward returns vs SPY, frozen, computed in batch (unchanged logic).
- **Materialize:** compute and write the serve artifacts (slim calls-index, leaderboard, scorecards, per-creator payloads) at the end of the run.
- **OG:** render only **new** creator/ticker cards on the VM → upload to Vercel Blob. No satori/resvg in the Vercel function bundle.
- **Publish:** write to Postgres → **bust cache tags** (per-creator after each creator's commit, global last; retried, idempotent) → **warm top routes** (home, leaderboard, each creator page) while the VM is still awake.

### 2. Store — Neon Postgres (ledger + source of truth)

Neon chosen over Turso/SQLite/Blob: serverless + scale-to-zero, Vercel Marketplace integration (env provisioning, unified billing), PITR + branching. At this volume Turso buys nothing (no embedded-replica benefit on ephemeral Vercel functions). Pure Blob-precomputed-JSON would meet "live without redeploy" too — the DB earns its place on the ingest/review/audit side, not serving.

Tables (sketch — finalized in the plan):

- `creators` — handle, name, platform, avatar, per-source cursor + `last_successful_ingest`.
- `calls` — the `Call` shape; upsert key `shortcode`; indexed for the materialize step.
- `prices` — frozen daily OHLC, **insert-only** (`REVOKE UPDATE, DELETE` from the ingest role). Scoring fetches only missing dates, never refreshes existing ones.
- `review_queue` — calls awaiting async human decision.
- `reject_audit` — judge-rejected calls, retained for audit + threshold recalibration.
- Materialized artifacts may be stored as DB rows/JSONB or pushed to Blob — decided in the plan.

**Roles:** read-only role for any serve-path access; insert-only-on-prices role for ingest. **Schema managed** via drizzle-kit (or equivalent) — no unmanaged ALTERs against the source of truth.

### 3. Serve — Vercel, precomputed artifacts

- **Slim calls-index:** one cached asset (~2–4 MB gzipped at 50k rows), one tag. Client-side filter / sort / search over it → instant, zero DB hits.
- **Leaderboard, scorecards, per-creator payloads:** precomputed at ingest, served cached.
- **Roster (`index.json`):** must move off the build-time `import.meta.glob` bundle to the DB/cache path, or new creators won't appear without a redeploy.
- **Caching:** Vercel Runtime Cache, tag-invalidated by the ingest run, with a **TTL ceiling ≤6h as a correctness backstop** in case a bust fails. Confirm Runtime Cache is per-region/ephemeral and verify tag-invalidation propagation semantics.
- **Live charts:** unchanged — Yahoo at request time, ~5min cache, baked OHLC fallback.
- **Staleness honesty:** surface `last_successful_ingest` per source as "data as of …" in the UI.

## Frozen scoring — enforced, not hoped

Git previously gave immutability for free. In a mutable DB:

- `prices` is **insert-only** at the DB level.
- The exact price inputs (or a hash) are **denormalized onto each call** at score time, so drift is _detectable_, not merely forbidden. (Yahoo _adjusted_ closes change retroactively on splits/dividends — "same date" ≠ "same number".)
- **Backup = Neon PITR + periodic dumps** to the VM or Blob (replaces git history as the point-in-time recovery story).

## Price data source & redistribution

The site is now **public**, which changes the price-data calculus. Yahoo (via `yahoo-finance2`), Tiingo, and Alpha-Vantage free tiers are **unofficial and/or forbid redistribution** — serving their data to the public (charts, baked scoring prices) is a ToS/legal exposure that did not exist for a private tool.

- **Scoring/baked prices:** prefer a source whose terms permit redistribution — **Stooq bulk EOD** is the usual clean choice for daily OHLC. Decide before public launch.
- **Live charts:** the request-time Yahoo fetch is the grayest area. Either move to a redistribution-permitting source or treat charts as client-fetched (the user's browser hits the source, not our server redistributing). Resolve in the plan.
- This is a launch blocker for the _public_ posture, not the architecture — flagged here so it is decided deliberately, not by default.

## Reliability & observability

- **Dead-man-switch:** ingest pings on success; alert on a missed window.
- **Per-source degradation:** IG failing must not block X (and vice versa).
- **"Data as of …"** surfaced in the UI per source.
- **Idempotent, cursor-resumable** ingest so a crashed/restarted run is safe.

## Security

- **Cache-bust endpoint:** shared bearer token from the VM, rotated.
- **Review queue:** host on the VM **behind Tailscale** (zero public auth surface) rather than as a public Vercel route.
- **Public DB-backed endpoints (if/when added):** mandatory pagination, clamped params, Vercel WAF rate limiting. Mostly mooted by the materialized-serve design.

## Migration — incremental, with a kill switch

Never big-bang (debugging cache + DB + new ingest + LLM gate at once). Sequence:

1. **Schema + backfill** from existing JSON (clean source, cheap, reversible).
2. **DB read path behind the current `fetchDataset()` / `fetchPrices()` interface.** Golden-master diff DB-served output vs static JSON. Flip per-route via env flag; static JSON stays as the panic fallback.
3. **New cross-creator features (leaderboard, all-calls filter) launch DB-first** — no static predecessor, zero cutover risk, natural pilot.
4. **Switch the ingest sink** — dual-write JSON + DB for a few cycles, then DB-only.
5. **LLM gate last**, after shadow-mode calibration against the golden set.

Move the roster (`index.json`) to the DB/cache path as part of step 2/3.

## YAGNI — explicitly deferred or cut

- `pg_trgm` / `tsvector` full-text search — deferred until search latency is a measured problem (creator search over ≤50 names is an array filter; call-text search is client-side over the slim index at this scale).
- Live SQL per page view — replaced by materialized aggregates.
- On-demand satori/resvg in Vercel functions — replaced by VM-render-into-Blob.
- Server-side faceted query path — built only past the ~50k-row crossover.

## Future: server-side query path (post-crossover)

When the call corpus exceeds ~50k rows or full-text over quotes/summaries is needed: introduce paginated server queries against Postgres with clamped, paginated, rate-limited parameters and `pg_trgm`/`tsvector` indexes. Not built now.

## Open decisions for the plan

- Artifact storage: DB JSONB rows vs Vercel Blob for the slim index / leaderboard / per-creator payloads.
- Exact frontier-judge model + per-run escalation cap.
- Drizzle vs alternative for schema migrations.
- Cron host for the trigger (VM-local cron vs Vercel Cron pinging the VM).
