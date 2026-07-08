# Plan 3b — VM Semi-Auto Ingest (X-first) Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> **v2** incorporates a Fable 5 review that caught two prod-data-loss blockers in v1 (backward-only scrape; unseeded VM state). Changes are marked **[v2]**.

**Goal:** A daily VM cron that incrementally refreshes existing X creators up to the human review gate (Telegram ping), then a human resumes over SSH to score → `db:sync` (Neon) → CDN revalidate — no redeploy.

**Architecture:** Reuse `pipeline:x`. Add (0,1) price-correctness fixes 3b's repeated re-scoring needs; (2) a **forward** incremental scrape mode; (3,4) a Telegram notifier + stage-1 wrapper; (5) CDN revalidate via the prerender bypass-token mechanism; (6) systemd timer for stage 1, with stage 2 (resume) manual over SSH. Correctness rides the already-shipped 6h ISR TTL; instant revalidate is best-effort.

**Tech:** Bun, TanStack Start (Nitro→Vercel), Neon (drizzle), systemd, Telegram Bot API. ARM Ubuntu VM (`ssh ubuntu@imos-vm`).

**Scope:** X path only (IG deferred). Refresh **existing** creators only (new-creator onboarding stays manual). Keep frozen/insert-only prices.

**Out of scope:** IG-on-VM, OG-on-VM, Parakeet, M3 deletion, `/`-into-ISR, Plan 4 judge, FAQ/report-button.

**[v2] Git policy — VM static writes are ephemeral scratch.** `score` rewrites tracked files (`dataset.json`, `index.json`, `data/prices/*`), but in `USE_DB=1` the **DB is source of truth** (db:sync pushes there; serve reads there). So the VM discards its local static churn before each pull: `git checkout -- data/ && git pull --ff-only`. Accepted drift: the git static **panic fallback**, OG cards, and baked `spark` go stale between manual redeploys — fine (OG-on-VM is deferred; fallback only triggers on a DB outage).

**Manual prerequisites (owner):** create a Vercel **bypass/revalidate** token; set `REVALIDATE_TOKEN` in Vercel prod env + VM `.env`; VM `.env` also needs `DATABASE_URL_INGEST`, **`DATABASE_URL_SERVE`** (parity-check reads it), `GROQ_API_KEY`, `FIREWORKS_API_KEY`, `RETTIWT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `INGEST_HANDLES`. Read-only SSH deploy key for the repo on the VM.

---

## Task -1 [v2]: Seed VM per-creator state (prerequisite — prevents data loss)

**Why:** `reel-calls.json`, `raw/`, `prices/` are gitignored (`.gitignore:19-23`), absent on a fresh clone. `score` rebuilds `dataset.json`/`index.json` from `reel-calls.json` (`score.ts:45,52`); an unseeded clone would scrape a short window → `db:sync` (upsert-only, no delete) would **corrupt the creator's scorecard/stats and break parity** (not delete call rows, but skew every aggregate). Seed full state from the source-of-truth checkout (your Mac), then a guard run _before_ score makes a truncated sync impossible.

**Files:** Create `scripts/guard-no-shrink.ts`; Test `scripts/guard-no-shrink.test.ts`.

- [ ] **Step 1:** Document + perform the seed (in `ops/README.md`, Task 6): from the Mac, `rsync -a data/creators/<h>/{reel-calls.json,raw,prices} ubuntu@imos-vm:~/influencer-tracker/data/creators/<h>/` for each existing X creator. (One-time; the VM then grows it incrementally.)

- [ ] **Step 2: Test the shrink guard** (pure fn):

```ts
// scripts/guard-no-shrink.test.ts
import { test, expect } from "bun:test";
import { wouldShrink } from "./guard-no-shrink";
test("flags a shrink below tolerance", () => {
  expect(wouldShrink(100, 80)).toBe(true); // 80 < 100*0.95
  expect(wouldShrink(100, 99)).toBe(false); // within tolerance
  expect(wouldShrink(0, 0)).toBe(false);
});
```

- [ ] **Step 3: Implement** `scripts/guard-no-shrink.ts`:

```ts
import { readFile } from "node:fs/promises";
// Refuse to sync if the freshly-scored call set is materially smaller than what's
// already published — the signature of an unseeded/partial scrape that would erase history.
export function wouldShrink(existing: number, incoming: number): boolean {
  return existing > 0 && incoming < existing * 0.95;
}
if (import.meta.main) {
  const handle = process.argv[2];
  // Compare LIKE-FOR-LIKE: committed dataset.calls (scored-only baseline) vs the scored
  // subset of the freshly-grown reel-calls. MUST run BEFORE score rewrites dataset.json
  // (stage-1's `git checkout -- data/` leaves dataset.json at the committed baseline).
  const ds = JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8"));
  const rc = JSON.parse(await readFile(`data/creators/${handle}/reel-calls.json`, "utf8"));
  const baseline = (ds.calls ?? []).length;
  const incoming = rc.filter((c: any) => c.isExplicitBuy && c.direction === "bullish").length;
  if (wouldShrink(baseline, incoming)) {
    console.error(`GUARD: ${handle} scored ${incoming} << baseline ${baseline}; refusing sync`);
    process.exit(1);
  }
  console.log(`guard ok: ${handle} scored ${incoming} >= baseline ${baseline}`);
}
```

(Comparing scored-vs-scored against the _committed_ baseline is the only valid signal — comparing all-ticker `reel-calls.length` to scored `dataset.calls`, or running after `score`, makes the guard mathematically unable to fire.)

- [ ] **Step 4: Run** — `bun test scripts/guard-no-shrink.test.ts` + `bunx tsc --noEmit` — PASS / 0.
- [ ] **Step 5: Commit** — `feat(vm): no-shrink sync guard (data-loss prevention)`

---

## Task 0: Forward-extension fix in `pipeline/prices.ts`

**Why:** `cacheCovers` checks only the series front, so `continue` skips established tickers forever — to-date returns ossify, recent horizons never mature. Extend forward from the last cached bar. Insert-only preserved.

**Files:** Modify `pipeline/prices.ts:43`; **amend** existing `pipeline/prices.test.ts` (do NOT recreate — it already covers `cacheCovers`).

- [ ] **Step 1:** Implement Task 1 (`detectBasisShift`) first, then replace the `continue` at `pipeline/prices.ts:43`:

```ts
if (cacheCovers(cached, from)) {
  // Front-covered: extend FORWARD instead of skipping, else to-date freezes and
  // recent horizons never mature. Fetch from ~10 days before the last bar so the
  // overlap is >=2 trading days — detectBasisShift needs >=2 overlapping bars to fire.
  const lastDate = cachedBars[cachedBars.length - 1]?.date ?? from;
  const overlapFrom = new Date(new Date(lastDate).getTime() - 10 * 86400_000)
    .toISOString()
    .slice(0, 10);
  try {
    const fwd = await fetchOhlc(t, overlapFrom);
    const shift = detectBasisShift(cachedBars, fwd);
    if (shift != null) {
      console.warn(
        `SPLIT ${t}: basis shift x${shift.toFixed(4)} — skipping append, needs OWNER restatement`,
      );
      continue;
    }
    const ohlc = mergePrices(cachedBars, fwd);
    await writeFile(out, JSON.stringify(ohlc));
    console.log(`prices ${t}: extended to ${ohlc[ohlc.length - 1]?.date} (${ohlc.length} bars)`);
  } catch (e) {
    console.warn(`FLAG ${t}: forward-extend failed: ${(e as Error).message}`);
  }
  continue;
}
```

- [ ] **Step 2:** Import `detectBasisShift` from `../src/lib/prices-merge` at top of `prices.ts`.
- [ ] **Step 3: Run** — `bun test pipeline/prices.test.ts` + `bunx tsc --noEmit` — PASS / 0.
- [ ] **Step 4: Commit** — `fix(prices): extend cached series forward (3b reactivity) + split guard`

---

## Task 1: Basis-shift (split) detection

**Why:** existing-wins `mergePrices` blindly welds pre/post-split series → silent ~-75% return cliff. Detect a consistent non-1 close ratio over ≥2 overlapping dates; halt the append.

**Files:** Add `detectBasisShift` to `src/lib/prices-merge.ts`; wire into `pipeline/prices.ts` (both merge sites) + `pipeline/score.ts:62-68` shared-store merge; Test `src/lib/prices-merge.test.ts`.

- [ ] **Step 1: Failing test:**

```ts
// add to src/lib/prices-merge.test.ts
import { detectBasisShift } from "./prices-merge";
test("detects consistent split-factor shift", () => {
  const existing = [
    { date: "2025-01-01", o: 400, h: 400, l: 400, c: 400 },
    { date: "2025-01-02", o: 404, h: 404, l: 404, c: 404 },
  ];
  const incoming = [
    { date: "2025-01-01", o: 100, h: 100, l: 100, c: 100 },
    { date: "2025-01-02", o: 101, h: 101, l: 101, c: 101 },
    { date: "2025-01-03", o: 102, h: 102, l: 102, c: 102 },
  ];
  expect(detectBasisShift(existing, incoming)).toBeCloseTo(0.25, 3);
});
test("null on same basis / <2 overlap", () => {
  const bars = [
    { date: "2025-01-01", o: 100, h: 100, l: 100, c: 100 },
    { date: "2025-01-02", o: 101, h: 101, l: 101, c: 101 },
  ];
  expect(detectBasisShift(bars, bars)).toBeNull();
  expect(detectBasisShift([bars[0]], [{ ...bars[0], c: 9 }])).toBeNull();
});
```

- [ ] **Step 2: Run** — `bun test src/lib/prices-merge.test.ts` — FAIL (not exported).
- [ ] **Step 3: Implement** (see v1 — `inc` map of date→close, ratios over overlap, `avg` within 1% → null, `every` within 2% of avg → factor else null).
- [ ] **Step 4: Wire** the guard before `mergePrices` at the non-covered branch in `prices.ts` (~line 53) and the `score.ts` shared-store merge; on non-null → `console.warn('SPLIT ...')` + skip that merge (keep existing). **Stage 2 runs manually over SSH, so the owner sees the `SPLIT` warning in stdout** (no wrapper log-scan needed).
- [ ] **Step 5: Run** — `bun test src/lib/prices-merge.test.ts` + tsc — PASS / 0.
- [ ] **Step 6: Commit** — `feat(prices): detect split basis-shift, halt merge`

---

## Task 2 [v2 — rewritten]: Forward incremental scrape mode

**Why:** `scrapeX` (`scrape-x.ts:90-141`) only walks **backwards** from the oldest seen tweet — designed to resume an interrupted backfill. With full seeded data it scrapes **zero** new tweets. A daily cron needs a **forward** pass: `[newest seen, now]`.

**Files:** Modify `pipeline/x/scrape-x.ts` (add `opts.forward`); Modify `pipeline/run-x.ts` (pass `--forward`).

- [ ] **Step 1:** Add an optional forward mode to `scrapeX`:

```ts
export async function scrapeX(
  handle: string,
  months = 12,
  opts: { forward?: boolean } = {},
): Promise<TweetRecord[]> {
  // ... existing setup: rettiwt, user, cutoff, records=loadExisting, seen ...
  if (opts.forward && records.length) {
    // Incremental: only tweets NEWER than the newest we already have. Use `newest` as-is
    // (no +1s) — `seen` dedupes the boundary tweet, and +1s would skip a different tweet
    // posted in the same second.
    const newest = new Date(Math.max(...records.map((r) => new Date(r.createdAt).getTime())));
    const filter = {
      fromUsers: [user],
      onlyOriginal: true,
      startDate: newest,
      endDate: new Date(),
    };
    let cursor: string | undefined;
    for (let page = 0; page < 400; page++) {
      const data: any = await withRetry(() => rettiwt.tweet.search(filter as any, 20, cursor), {
        label: `x.fwd`,
        isRetryable: isTransient,
        retries: 10,
        delayMs: (a) => Math.min(2 ** a, 120) * 1000,
      });
      for (const t of data.list ?? []) {
        const rec = toRecord(t);
        if (!seen.has(rec.id)) {
          seen.add(rec.id);
          records.push(rec);
        }
      }
      await persist(handle, records);
      if (!data.next || !data.list?.length) break;
      cursor = data.next;
    }
    console.log(`forward scrape: ${records.length} total (${seen.size} unique)`);
    // fall through to the shared image-download + return below; SKIP the backward walk.
  } else {
    // ... existing backward-walk backfill loop (unchanged) ...
  }
  // ... existing shared tail: mkdir(rawDir), download images for new tweets, return records ...
}
```

(Refactor the existing backward loop into the `else`; hoist the `incomplete`/`w` vars so the shared tail is reached by both paths; keep the image-download tail shared. `months`/`cutoff` stay for the backfill path. **Also add an `existsSync` skip in the image-download tail** — currently it re-downloads images for ALL historical records every run; post-seed that's thousands of CDN fetches per daily cron.)

- [ ] **Step 2:** In `run-x.ts`, parse `--forward` (a valueless flag) and thread it. NOTE the parser maps `--flag → [flag, next]`, so a trailing `--forward` yields `{forward: undefined}` — test membership, not value: `await scrapeX(handle, months, { forward: "forward" in args });`
- [ ] **Step 3: Run** — `bunx tsc --noEmit` — 0. (Behavior verified live in Task 8 — network-bound.)
- [ ] **Step 4: Commit** — `feat(x): forward incremental scrape mode for cron`

---

## Task 3: Telegram notifier helper

**Files:** Create `scripts/notify.ts`; Test `scripts/notify.test.ts`.

- [ ] **Step 1: Test** `reviewMessage` includes handle, new-call count, and a `flock`'d resume that calls `scripts/resume.ts` (which centralizes guard→score→sync→revalidate in the correct order — see Step 3):

```ts
import { test, expect } from "bun:test";
import { reviewMessage } from "./notify";
test("review ping carries handle, counts, and the flock'd resume", () => {
  const m = reviewMessage("TheProfInvestor", 3, 2);
  expect(m).toContain("TheProfInvestor");
  expect(m).toContain("3 new");
  expect(m).toContain("flock");
  expect(m).toContain("resume.ts");
});
```

- [ ] **Step 2: Implement** `scripts/notify.ts` (resume is a single flock'd script call — no nested-quote hell, and the lock matches the timer so resume can't race it):

```ts
export function reviewMessage(handle: string, newCalls: number, newScored: number): string {
  return [
    `📋 ${handle}: ${newCalls} new calls (${newScored} newly scored).`,
    `Review: ssh ubuntu@imos-vm 'cat ~/influencer-tracker/data/creators/${handle}/calls.review.md'`,
    `Resume: ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}"`,
  ].join("\n");
}
export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN,
    chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.warn("notify: TELEGRAM_* unset");
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) console.warn(`notify failed: ${r.status}`);
}
```

- [ ] **Step 3: Create `scripts/resume.ts`** (stage 2 — guard runs FIRST, before `score` rewrites `dataset.json`; `$` throws on non-zero so a failed guard halts the chain; revalidate is best-effort):

```ts
import { readFile } from "node:fs/promises";
import { $ } from "bun";
const handle = process.argv[2];
if (!handle) {
  console.error("usage: resume <handle>");
  process.exit(1);
}
// 1. Guard against a truncated scrape BEFORE score overwrites the committed baseline.
await $`bun run scripts/guard-no-shrink.ts ${handle}`;
// 2. Score (reads name from the committed dataset so updateIndex doesn't rename the creator).
const name =
  JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8")).creator?.name ??
  handle;
await $`bun run pipeline:x --handle ${handle} --name ${name} --from prices`;
// 3. Sync to Neon + parity, then best-effort cache-bust.
await $`bun run db:sync`;
await $`bun run scripts/parity-check.ts`;
await $`bun run scripts/revalidate-creator.ts ${handle}`.nothrow();
```

- [ ] **Step 4: Run** — `bun test scripts/notify.test.ts` + tsc — PASS / 0.
- [ ] **Step 5: Commit** — `feat(vm): telegram notifier + flock'd resume script (guard-first)`

---

## Task 4: Stage-1 ingest wrapper

**Why:** the timer entry point — forward-scrape + extract each configured creator, count NEW calls, Telegram the review ping. Any throw → alert (dead-man).

**Files:** Create `scripts/ingest.ts`.

- [ ] **Step 1: Implement** ([v2] uses `INGEST_HANDLES` env list — index.json has no platform field):

```ts
import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { notify, reviewMessage } from "./notify";

const handles = (process.env.INGEST_HANDLES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!handles.length) {
  console.error("INGEST_HANDLES unset");
  process.exit(1);
}

async function counts(h: string) {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${h}/reel-calls.json`, "utf8"));
    return {
      total: rc.length,
      scored: rc.filter((x: any) => x.isExplicitBuy && x.direction === "bullish").length,
    };
  } catch {
    return { total: 0, scored: 0 };
  }
}

for (const h of handles) {
  try {
    const before = await counts(h);
    const name =
      JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    await $`bun run pipeline:x --handle ${h} --name ${name} --forward`; // scrape(forward)+extract, pauses
    const after = await counts(h);
    const fresh = after.total - before.total;
    if (fresh > 0) await notify(reviewMessage(h, fresh, after.scored - before.scored));
    else console.log(`${h}: no new calls`);
  } catch (e) {
    await notify(`🚨 ingest FAILED ${h}: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 2:** `bunx tsc --noEmit` — 0.
- [ ] **Step 3: Commit** — `feat(vm): stage-1 ingest wrapper (forward scrape + review ping)`

---

## Task 5 [v2 — re-aimed]: CDN revalidate via prerender bypass token

**Why:** `isr` compiles to Vercel **prerender functions**, which support on-demand revalidation via a **`bypassToken`** + a GET to the path with header `x-prerender-revalidate: <token>` — NOT a REST purge API (v1 was wrong). Value is marginal over the 6h TTL, so spike-then-best-effort.

**Files:** Spike `vite.config.ts` (Nitro `isr` object form); Create `scripts/revalidate-creator.ts`; optionally simplify `src/routes/api/revalidate.ts`.

- [ ] **Step 1: Spike (document findings in commit):** confirm Nitro→Vercel accepts `routeRules: { '/c/**': { isr: { expiration: 21600, /* bypassToken? */ } } }` and emits a stable `bypassToken` in `prerender-config.json` (or whether the token is per-build). If no stable on-demand mechanism exists for Nitro output → STOP: keep TTL-only, document it, skip steps 2-3 (correctness already holds via TTL).

- [ ] **Step 2 (if viable): Implement** `scripts/revalidate-creator.ts <handle>`: GET the creator's paths (`/c/<h>`, `/api/dataset/<h>`, `/explore`, `/api/calls-index`, each touched `/t/<sym>` + `/api/prices/<sym>` from the dataset) against the prod origin with `x-prerender-revalidate: <REVALIDATE_TOKEN>`. Best-effort: log + continue on non-2xx, never throw (TTL heals). This replaces the `/api/revalidate` POST as the actual cache-buster; the existing seam can stay as the documented Plan-3b POST target or be retired.

- [ ] **Step 3: Test** — pure path-list builder fn (given a dataset, returns the path set); network is manual.
- [ ] **Step 4: Run** — tsc 0. **Step 5: Commit** — `feat(revalidate): prerender bypass-token cache-bust (or TTL-only per spike)`

---

## Task 6: systemd timer (stage 1) + ops runbook

**Files:** Create `ops/influencer-ingest.service`, `ops/influencer-ingest.timer`, `ops/notify-fail.service`, `ops/README.md`.

- [ ] **Step 1:** Service ([v2] fixes: explicit PATH, `flock` against ingest-vs-resume, `RuntimeMaxSec` dead-man, `OnFailure` unit, system service with `User=ubuntu`, ephemeral-scratch git reset):

```ini
# ops/influencer-ingest.service
[Unit]
Description=influencer-tracker stage-1 ingest (X, forward incremental)
OnFailure=notify-fail.service
[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/influencer-tracker
EnvironmentFile=/home/ubuntu/influencer-tracker/.env
Environment=PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin
RuntimeMaxSec=4h
# VM static writes are ephemeral (DB is truth) — discard tracked + untracked new-symbol price
# files, then pull. clean ONLY data/prices (never data/creators — that holds seeded state).
# flock serializes vs a manual resume.
ExecStart=/usr/bin/flock -n /tmp/influencer-ingest.lock bash -c 'git checkout -- data/ && git clean -fd data/prices/ && git pull --ff-only && bun run scripts/ingest.ts'
```

```ini
# ops/influencer-ingest.timer
[Unit]
Description=daily influencer-tracker ingest
[Timer]
OnCalendar=*-*-* 13:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

```ini
# ops/notify-fail.service  — dead-man backstop for crashes/timeouts the wrapper's try/catch misses
[Service]
Type=oneshot
User=ubuntu
EnvironmentFile=/home/ubuntu/influencer-tracker/.env
Environment=PATH=/home/ubuntu/.bun/bin:/usr/bin:/bin
WorkingDirectory=/home/ubuntu/influencer-tracker
ExecStart=/home/ubuntu/.bun/bin/bun -e 'import("./scripts/notify.ts").then(m=>m.notify("🚨 influencer-ingest unit failed/timed out"))'
```

- [ ] **Step 2:** `ops/README.md` — deploy key, `bun install`, **the Task--1 rsync seed**, `.env` key list (incl `DATABASE_URL_SERVE`, `INGEST_HANDLES`), `flock` note, copy units to `/etc/systemd/system/`, `systemctl enable --now influencer-ingest.timer`, and the manual stage-2 resume (the exact command from `reviewMessage`). Note resume also takes the `flock` so it can't race the timer.
- [ ] **Step 3: Commit** — `feat(ops): systemd timer + dead-man + VM runbook`

---

## Task 7: Docs — CLAUDE.md 3b section

- [ ] Update the live-invariant/"DB vs static" section: 3b shipped, daily forward-incremental X ingest semi-auto, the resume runbook, the price forward-extension + split-halt behavior, the ephemeral-scratch git policy, and revalidate status (bypass-token or TTL-only per Task 5).
- [ ] Commit — `docs: 3b VM semi-auto ingest`

---

## Task 8: End-to-end manual verification (on the VM)

- [ ] Deploy key + `bun install`; **rsync-seed** per-creator state (Task -1); populate `.env` (incl `DATABASE_URL_SERVE`, `INGEST_HANDLES`).
- [ ] Stage 1: `INGEST_HANDLES=TheProfInvestor bun run scripts/ingest.ts` → Telegram review ping arrives; `calls.review.md` shows only NEW rows; no scored data written yet; `reel-calls.json` grew (didn't shrink).
- [ ] Review, then stage 2 (the `reviewMessage` command): guard passes → `--from prices` → `db:sync` → `parity-check` prints `PARITY OK` → revalidate (or TTL).
- [ ] Confirm live: `/api/dataset/<h>` + `/c/<h>` reflect the change (≤6h, or immediately if revalidate wired).
- [ ] Enable timer; `systemctl list-timers` shows next run. Force-fail once (bad env) → confirm `notify-fail` Telegrams.
- [ ] Final: dispatch a code-quality reviewer over the whole branch before merge.

---

## Self-review notes

- **Blockers from v1 fixed:** forward-scrape (Task 2), VM seeding + shrink guard (Task -1), git policy (header + Task 6), 1-bar-overlap split blindness (Task 0 overlapFrom), purge mechanism (Task 5 bypass-token), `--name` in resume (Task 3), `DATABASE_URL_SERVE` (prereqs), amend-not-recreate `prices.test.ts` (Task 0).
- **v2.1 fixes (2nd Fable pass):** `--forward` tested by membership `"forward" in args` not value (else dead code → cron silently no-ops); shrink guard runs FIRST via `scripts/resume.ts` and compares scored-vs-scored (else mathematically unable to fire); resume is `flock`'d (matches the timer); `git clean -fd data/prices/` (new-symbol untracked files would break `--ff-only`); dropped `newest+1s`; `existsSync`-skip the image re-download; softened "wipe history" → "corrupt stats/parity (backfill is upsert-only)".
- **Verify-before-implementing:** Task 5 spike (Nitro `isr` bypassToken). Everything else verified against code during review.
- Frozen/insert-only preserved: forward-extension and split-detection only append or halt, never rewrite a scored bar.
- Two creators only; `INGEST_HANDLES` keeps X-only selection explicit and honest.
