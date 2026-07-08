# Durable IG Post-Date Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the GraphQL post dates the IG scraper already harvests into a committed, accumulating per-creator store, and make that store the source of truth for `extract`, so daily IG re-extract reproduces every reel's anchor date without depending on the disposable `raw/` directory.

**Architecture:** A new `pipeline/post-dates.ts` owns the store (`data/creators/<h>/post-dates.json`) and pure helpers. `scrape.ts` becomes the primary writer (persists `seen` dates after each scroll). `extract.ts`'s `postDateOf` reads the store FIRST and only falls back to `info.json`, freezing any info.json-sourced date back into the store. A one-time backfill seeds the store for existing IG creators from their committed `dataset.json`. The store file is added to the `.gitignore` allow-list so it is committed and durable.

**Tech Stack:** Bun + TypeScript, `bun:test`, `node:fs/promises`. The `#/` alias maps to `src/`.

## Global Constraints

- **Worktree:** all work happens in the `ig-ingest` worktree at `/Users/imo/Documents/GitHub/influencer-tracker-ig-ingest`; never edit on `main`. Build/typecheck/test in the worktree; VM deploy + canary after merge.
- **Tests:** `bun test`. Typecheck: `bunx tsc --noEmit`.
- **Store path + shape:** `data/creators/<handle>/post-dates.json` = `{ "<shortcode>": "YYYY-MM-DD" }`.
- **Durable store WINS** over `info.json` in `postDateOf` (reproducibility: a reel's anchor must not flip based on whether `raw/` is present).
- **`mergePostDates` is existing-wins** on key collision (a reel's date is immutable; mirrors the project's frozen-scoring / insert-only rule).
- **`formatTakenAt` formats in UTC** (`new Date(ms).toISOString().slice(0, 10)`) and returns `null` for non-finite or non-positive ms (never writes a 1970 date).
- **`savePostDates` writes atomically** (temp file then rename) — the store is committed; a partial write must never truncate it.
- **Backfill detects IG creators by non-numeric shortcodes** via `majorityNumeric` from `scripts/shortcodes.ts` (do not hardcode a handle list); seeds from `dataset.json` postDates; idempotent.
- **Isolation:** do not modify the X path (`pipeline/run-x.ts`, `pipeline/x/*`, `scripts/ingest.ts`). `scrape.ts`/`extract.ts` are shared IG-pipeline files — edit only as specified.
- **Static-serve:** `data/` is the source of truth; the store ships as committed data like `dataset.json`.
- **Security:** the store holds only public reel codes + public dates — no PII, no credential bytes. Leave `cookies.txt` / `.chrome-profile` untouched.

---

### Task 1: The store module + gitignore allow-list

Create the durable store and its pure helpers, and make the file committable. Deliverable: `post-dates.json` round-trips through load/save, the helpers behave per spec, and `git check-ignore` confirms the file is no longer ignored.

**Files:**

- Create: `pipeline/post-dates.ts`
- Create: `pipeline/post-dates.test.ts`
- Modify: `.gitignore` (add the allow-list negation)

**Interfaces:**

- Consumes: `creatorDir` from `pipeline/config.ts`.
- Produces:
  - `formatTakenAt(ms: number): string | null` — UTC `YYYY-MM-DD`; `null` for non-finite/≤0.
  - `mergePostDates(existing: Record<string,string>, incoming: Record<string,string>): Record<string,string>` — existing-wins, returns a new object, mutates neither input.
  - `loadPostDates(handle: string): Promise<Record<string,string>>` — `{}` when the file is missing or unparseable.
  - `savePostDates(handle: string, map: Record<string,string>): Promise<void>` — atomic temp-then-rename write.

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// pipeline/post-dates.test.ts
import { test, expect } from "bun:test";
import { formatTakenAt, mergePostDates } from "./post-dates";

test("formatTakenAt: UTC YYYY-MM-DD; null for falsy/invalid", () => {
  // 2026-03-11T00:00:00Z = 1773187200000 ms
  expect(formatTakenAt(1773187200000)).toBe("2026-03-11");
  // near a midnight-UTC boundary stays on the UTC day
  expect(formatTakenAt(Date.UTC(2026, 2, 11, 23, 59, 0))).toBe("2026-03-11");
  expect(formatTakenAt(0)).toBe(null);
  expect(formatTakenAt(-1)).toBe(null);
  expect(formatTakenAt(Number.NaN)).toBe(null);
});

test("mergePostDates: existing-wins, adds new, no mutation", () => {
  const existing = { a: "2026-01-01" };
  const incoming = { a: "2026-09-09", b: "2026-02-02" };
  const out = mergePostDates(existing, incoming);
  expect(out).toEqual({ a: "2026-01-01", b: "2026-02-02" });
  expect(existing).toEqual({ a: "2026-01-01" }); // unchanged
  expect(incoming).toEqual({ a: "2026-09-09", b: "2026-02-02" }); // unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test pipeline/post-dates.test.ts`
Expected: FAIL — `Cannot find module './post-dates'`.

- [ ] **Step 3: Write the module**

```ts
// pipeline/post-dates.ts
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { creatorDir } from "./config";

// Durable per-creator post-date store: { "<shortcode>": "YYYY-MM-DD" }. Committed (see
// .gitignore allow-list) so it survives raw/ purge + the VM's `git checkout -- data/` +
// `git clean -fd`. It is the source of truth for extract's anchor date, independent of raw/.
function storePath(handle: string) {
  return join(creatorDir(handle), "post-dates.json");
}

// Format a GraphQL taken_at (UTC epoch ms) as a UTC calendar day. Null for a missing/zero
// taken_at (scrape stores `(node.taken_at ?? 0) * 1000`) so a 1970 date is never written.
export function formatTakenAt(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// Existing-wins: a reel's post date is immutable, so a date already committed is frozen and
// never overwritten by a later (possibly ≤1-day-skewed) re-derivation. Returns a new object.
export function mergePostDates(
  existing: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  return { ...incoming, ...existing };
}

export async function loadPostDates(handle: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(storePath(handle), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

// Atomic write: a crash mid-write must not truncate the committed store.
export async function savePostDates(handle: string, map: Record<string, string>): Promise<void> {
  await mkdir(creatorDir(handle), { recursive: true });
  const p = storePath(handle);
  const tmp = `${p}.tmp`;
  await writeFile(tmp, JSON.stringify(map, null, 2));
  await rename(tmp, p);
}
```

- [ ] **Step 4: Run the pure-helper test to verify it passes**

Run: `bun test pipeline/post-dates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the load/save round-trip test**

```ts
// append to pipeline/post-dates.test.ts
import { loadPostDates, savePostDates } from "./post-dates";
import { rmSync } from "node:fs";
import { DATA } from "./config";
import { join as pjoin } from "node:path";

test("save then load round-trips; missing file -> {}", async () => {
  const handle = `__test_pd_${Date.now()}`;
  try {
    expect(await loadPostDates(handle)).toEqual({}); // missing -> {}
    await savePostDates(handle, { ABC123: "2026-03-11" });
    expect(await loadPostDates(handle)).toEqual({ ABC123: "2026-03-11" });
  } finally {
    rmSync(pjoin(DATA, "creators", handle), { recursive: true, force: true });
  }
});
```

(`creatorDir(handle)` resolves to `data/creators/<handle>`, so the test writes under a throwaway handle in `DATA` and cleans up — mirrors `scrape-forward.test.ts`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test pipeline/post-dates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Add the `.gitignore` allow-list negation**

The existing block ignores `data/creators/*/*` but re-includes the dirs and `dataset.json`:

```
data/creators/*
!data/creators/index.json
!data/creators/*/
data/creators/*/*
!data/creators/*/dataset.json
```

Add the new negation **immediately after** `!data/creators/*/dataset.json` (last match wins, and the `!data/creators/*/` dir re-inclusion is what makes a file-level negation effective):

```
!data/creators/*/post-dates.json
```

- [ ] **Step 8: Verify the file is committable**

Run: `git check-ignore data/creators/roadto100kportfolio/post-dates.json; echo "exit=$?"`
Expected: prints nothing and `exit=1` (not ignored → committable). (`git check-ignore` exits 1 when a path is NOT ignored.)

- [ ] **Step 9: Commit**

```bash
git add pipeline/post-dates.ts pipeline/post-dates.test.ts .gitignore
git commit -m "feat(ig): durable post-date store module + gitignore allow-list"
```

---

### Task 2: `extract.ts` reads the store first, freezes info.json dates

Make the durable store the source of truth in `postDateOf` (store-first, `info.json` fallback), and merge any info.json-sourced date back into the store so it is frozen for future runs.

**Files:**

- Modify: `pipeline/extract.ts` (`postDateOf` at lines ~15-26; `extract` worker at ~53-66; module top)
- Test: `pipeline/extract.test.ts` (new file, or append if one exists)

**Interfaces:**

- Consumes: `loadPostDates`, `savePostDates`, `mergePostDates` from `./post-dates`; existing `formatUploadDate` (unchanged).
- Produces: `postDateOf(store: Record<string,string>, handle: string, code: string): Promise<string | null>` — store-first, then `info.json`; `null` when both miss.

- [ ] **Step 1: Write the failing test (precedence is the core fix)**

```ts
// pipeline/extract.test.ts
import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./config";
import { postDateOf } from "./extract";

test("postDateOf: durable store wins over info.json; falls back when absent", async () => {
  const handle = `__test_ex_${Date.now()}`;
  const code = "ABC123";
  const rawCodeDir = join(DATA, "creators", handle, "raw", code);
  mkdirSync(rawCodeDir, { recursive: true });
  try {
    // info.json on disk says one date...
    writeFileSync(join(rawCodeDir, "x.info.json"), JSON.stringify({ upload_date: "20260101" }));
    // ...but the store says another -> store WINS (reproducibility).
    expect(await postDateOf({ [code]: "2026-03-11" }, handle, code)).toBe("2026-03-11");
    // store miss + info.json present -> info.json value
    expect(await postDateOf({}, handle, code)).toBe("2026-01-01");
    // store miss + info.json absent -> null
    expect(await postDateOf({}, handle, "NOPE")).toBe(null);
  } finally {
    rmSync(join(DATA, "creators", handle), { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test pipeline/extract.test.ts`
Expected: FAIL — `postDateOf` is not exported / arity mismatch (currently `postDateOf(handle, code)` and not exported).

- [ ] **Step 3: Update the imports at the top of `pipeline/extract.ts`**

Add to the imports (the file already imports from `./calls`, `./fireworks`, `./config`):

```ts
import { loadPostDates, savePostDates, mergePostDates } from "./post-dates";
```

- [ ] **Step 4: Replace `postDateOf` (lines ~15-26) with the store-first version**

Replace:

```ts
async function postDateOf(handle: string, code: string): Promise<string | null> {
  // yt-dlp info json: upload_date YYYYMMDD. Null when unknown — the caller skips
  // rather than fabricating a date (a wrong anchor silently corrupts every return).
  const dir = join(rawDir(handle), code);
  if (!existsSync(dir)) return null;
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    return formatUploadDate(j.upload_date);
  }
  return null;
}
```

with:

```ts
// Durable store WINS: the anchor must not flip based on whether raw/ is present this run
// (that would silently restate forward returns). info.json is only a gap-filler for a reel
// not yet in the store; the caller freezes that resolved date back into the store. Null when
// both miss — skip rather than fabricate (a wrong anchor silently corrupts every return).
export async function postDateOf(
  store: Record<string, string>,
  handle: string,
  code: string,
): Promise<string | null> {
  if (store[code]) return store[code];
  const dir = join(rawDir(handle), code);
  if (!existsSync(dir)) return null;
  const info = (await readdir(dir)).find((f) => f.endsWith(".info.json"));
  if (info) {
    const j = JSON.parse(await readFile(join(dir, info), "utf8"));
    return formatUploadDate(j.upload_date);
  }
  return null;
}
```

- [ ] **Step 5: Load the store once and freeze info.json dates in `extract()`**

In `extract(handle)`, after `const files = (await readdir(...))...` and before the worker pool, add:

```ts
// Durable post-date store is the source of truth for anchors (see post-dates.ts). Load once;
// collect any date a worker resolves from info.json (i.e. not already in the store) so it is
// frozen here and used directly on every future run, independent of raw/.
const store = await loadPostDates(handle);
const discovered: Record<string, string> = {};
```

Replace the worker's date resolution:

```ts
const postDate = await postDateOf(handle, code);
if (postDate == null) {
  console.warn(`skip ${code}: no upload_date in info.json`);
  results[i] = [];
  continue;
}
```

with:

```ts
const postDate = await postDateOf(store, handle, code);
if (postDate == null) {
  console.warn(`skip ${code}: no post date (store or info.json)`);
  results[i] = [];
  continue;
}
// Resolved from info.json (absent in the store) -> freeze it.
if (!(code in store)) discovered[code] = postDate;
```

Then after `await Promise.all(...)` and before `const out: ReelCall[] = results.flat();`, add:

```ts
if (Object.keys(discovered).length) await savePostDates(handle, mergePostDates(store, discovered));
```

- [ ] **Step 6: Run the test + typecheck**

Run: `bun test pipeline/extract.test.ts && bunx tsc --noEmit`
Expected: test PASS; tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add pipeline/extract.ts pipeline/extract.test.ts
git commit -m "feat(ig): extract reads durable post-date store first, freezes info.json dates"
```

---

### Task 3: `scrape.ts` persists harvested dates to the store

Make `scrape()` the primary store writer: after the scroll, persist every `seen` reel's GraphQL `taken_at` to the store (merged, existing-wins). Browser-driven — no unit test; verified by the VM canary in Task 6.

**Files:**

- Modify: `pipeline/scrape.ts` (imports at top; insert after the `shortcodes.json` write at line ~186)

**Interfaces:**

- Consumes: `loadPostDates`, `savePostDates`, `mergePostDates`, `formatTakenAt` from `./post-dates`; the existing `seen: Map<string, number>` (shortcode → taken_at ms).

- [ ] **Step 1: Add the import to `pipeline/scrape.ts`**

Add near the other local imports (the file already imports `knownShortcodes, forwardCaughtUp` from `./scrape-forward`):

```ts
import { loadPostDates, savePostDates, mergePostDates, formatTakenAt } from "./post-dates";
```

- [ ] **Step 2: Persist the harvested dates (insert after line ~186, before `return recent;`)**

The current tail of `scrape()` is:

```ts
const recent = [...seen.entries()].filter(([, t]) => !t || t >= cutoff).map(([code]) => code);
await mkdir(rawDir(handle), { recursive: true });
await writeFile(join(rawDir(handle), "shortcodes.json"), JSON.stringify(recent, null, 2));
return recent;
```

Insert between the `shortcodes.json` write and `return recent;`:

```ts
// Persist harvested GraphQL dates to the durable store (the source of truth for extract's
// anchor). Every seen reel with a positive taken_at; existing-wins so an already-committed
// date is frozen. This is the primary writer — info.json is only a fallback in extract.
const harvested: Record<string, string> = {};
for (const [code, ms] of seen.entries()) {
  const d = formatTakenAt(ms);
  if (d) harvested[code] = d;
}
await savePostDates(handle, mergePostDates(await loadPostDates(handle), harvested));
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add pipeline/scrape.ts
git commit -m "feat(ig): scrape persists harvested GraphQL dates to the durable store"
```

---

### Task 4: One-time backfill from `dataset.json`

Seed the store for existing IG creators from their committed `dataset.json` postDates, so the first post-fix re-extract recovers every previously-scored reel's anchor. Detect IG creators by non-numeric shortcodes; idempotent.

**Files:**

- Create: `scripts/backfill-post-dates.ts`
- Test: `scripts/backfill-post-dates.test.ts`

**Interfaces:**

- Consumes: `majorityNumeric` from `./shortcodes`; `loadPostDates`, `savePostDates`, `mergePostDates` from `../pipeline/post-dates`.
- Produces: `postDatesFromDataset(calls: { shortcode?: unknown; postDate?: unknown }[]): Record<string,string>` — `{shortcode: postDate}`, deduped by shortcode (first non-empty wins), dropping entries missing either field.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/backfill-post-dates.test.ts
import { test, expect } from "bun:test";
import { postDatesFromDataset } from "./backfill-post-dates";

test("postDatesFromDataset: dedup by shortcode, drop incomplete", () => {
  const calls = [
    { shortcode: "ABC", ticker: "NVDA", postDate: "2026-03-11" },
    { shortcode: "ABC", ticker: "AMD", postDate: "2026-03-11" }, // same reel, multi-ticker
    { shortcode: "DEF", ticker: "TSLA", postDate: "2026-04-01" },
    { shortcode: "GHI", ticker: "X", postDate: "" }, // no date -> dropped
    { ticker: "Y", postDate: "2026-05-05" }, // no shortcode -> dropped
  ] as any;
  expect(postDatesFromDataset(calls)).toEqual({ ABC: "2026-03-11", DEF: "2026-04-01" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/backfill-post-dates.test.ts`
Expected: FAIL — `Cannot find module './backfill-post-dates'`.

- [ ] **Step 3: Write the script**

```ts
// scripts/backfill-post-dates.ts
import { readFile, readdir } from "node:fs/promises";
import { majorityNumeric } from "./shortcodes";
import { loadPostDates, savePostDates, mergePostDates } from "../pipeline/post-dates";

// Pure: build {shortcode: postDate} from a dataset's calls, deduped by shortcode (a multi-ticker
// post repeats its shortcode with one shared date). Drops entries missing either field.
export function postDatesFromDataset(
  calls: { shortcode?: unknown; postDate?: unknown }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of calls) {
    const code = String(c.shortcode ?? "");
    const date = String(c.postDate ?? "");
    if (code && date && !(code in out)) out[code] = date;
  }
  return out;
}

// Seed the durable store for every IG creator (non-numeric shortcodes) from its committed
// dataset.json. Idempotent: existing-wins merge means a re-run never changes a frozen date.
async function main() {
  const creatorsDir = "data/creators";
  const entries = await readdir(creatorsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const handle = e.name;
    let calls: { shortcode?: unknown; postDate?: unknown }[];
    try {
      const ds = JSON.parse(await readFile(`${creatorsDir}/${handle}/dataset.json`, "utf8"));
      calls = ds.calls ?? [];
    } catch {
      console.log(`skip ${handle}: no readable dataset.json`);
      continue;
    }
    const codes = calls.map((c) => String(c.shortcode ?? "")).filter(Boolean);
    if (majorityNumeric(codes)) {
      console.log(`skip ${handle}: X creator (numeric shortcodes)`);
      continue;
    }
    const seeded = postDatesFromDataset(calls);
    const merged = mergePostDates(await loadPostDates(handle), seeded);
    await savePostDates(handle, merged);
    console.log(
      `seeded ${handle}: ${Object.keys(seeded).length} dates -> store has ${Object.keys(merged).length}`,
    );
  }
}

if (import.meta.main) await main();
```

- [ ] **Step 4: Run the test + typecheck**

Run: `bun test scripts/backfill-post-dates.test.ts && bunx tsc --noEmit`
Expected: test PASS; tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-post-dates.ts scripts/backfill-post-dates.test.ts
git commit -m "feat(ig): one-time backfill seeding post-date store from dataset.json"
```

---

### Task 5: Full verification + merge to `main`

All code in place; verify the whole worktree, then ship IG-only to `origin/main` (preserving the user's local UI WIP), exactly as the IG-ingest branch was shipped.

- [ ] **Step 1: Full verification in the worktree**

Run: `bunx tsc --noEmit && bun test`
Expected: tsc exit 0; all tests pass (the new post-dates/extract/backfill tests included), 0 failures.

- [ ] **Step 2: Rebase onto origin/main and push IG-only**

The user's local `main` carries unpushed UI WIP; do NOT merge through local `main`. Rebase the worktree branch onto `origin/main` and push its HEAD to `main` (fast-forward), so only this branch's commits ship.

```bash
git fetch origin
git rebase origin/main          # replays this branch's commits onto latest origin/main
bunx tsc --noEmit && bun test   # re-verify after rebase (a data refresh may have landed underneath)
git push origin HEAD:main
git ls-remote origin main       # confirm origin/main == local HEAD
```

Expected: clean rebase (no overlap with UI files); verification green; ff push succeeds. If the rebase conflicts (it should not — this branch touches `pipeline/`, `scripts/`, `.gitignore`, `docs/` only), stop and report.

---

### Task 6: VM deploy — backfill, re-canary, re-enable timer

Deploy the fix on the VM: pull, seed the stores, commit them, re-run the canary to confirm the 0-call bug is gone, then re-enable the IG timer. The timer was stopped + disabled when the bug was found.

- [ ] **Step 1: Pull the fix on the VM**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && git checkout -- data/ && git pull --ff-only && git log --oneline -1'
```

Expected: pull succeeds; HEAD is the post-date fix commit.

- [ ] **Step 2: Seed the stores + commit them**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && export PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin && bun run scripts/backfill-post-dates.ts && git add data/creators/*/post-dates.json && git status --porcelain data/ | head && git -c user.name=ingest-bot -c user.email=ingest@imos-vm commit -m "data: seed durable IG post-date stores" && git push origin main'
```

Expected: backfill logs a seeded-count per IG creator (and skips X creators); the new `post-dates.json` files are committed + pushed. (If `git push` rejects non-ff because the Mac pushed concurrently, `git pull --rebase origin main && git push`.)

- [ ] **Step 3: Re-run the canary (the bug-gone proof)**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && flock -w 60 /tmp/influencer-ingest.lock bash -c "export PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin; INGEST_HANDLES_IG=roadto100kportfolio xvfb-run -a bun run scripts/ingest-ig.ts"; echo "INNER_EXIT=$?"'
```

Expected: scrape logs egress IP + "caught up to known reels"; `extract` resolves dates from the store (NO `skip … no post date` flood); resume runs guard + score; either a published summary (count at/near 244) or a _legitimate_ guard block for operator review — but NOT the 0-call bug. `INNER_EXIT=0` on a clean publish.

- [ ] **Step 4: Confirm freshness**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && export PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin && bun -e "const d=require(\"./data/creators/roadto100kportfolio/dataset.json\");console.log(\"generatedAt:\",d.generatedAt,\"scored:\",d.calls.length)"; git log --oneline -1'
```

Expected: `generatedAt` is today (if there were changes); `scored` is at/near 244.

- [ ] **Step 5: Re-enable + start the IG timer**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && sudo systemctl enable --now influencer-ingest-ig.timer && systemctl list-timers influencer-ingest-ig.timer --all --no-pager'
```

Expected: timer enabled, next fire at 14:00 UTC.

- [ ] **Step 6: Remove the worktree (after the canary confirms the fix)**

```bash
# from the primary checkout /Users/imo/Documents/GitHub/influencer-tracker
git worktree remove ../influencer-tracker-ig-ingest
git branch -D ig-ingest   # branch's commits are on origin/main via the ff pushes
```

(Only after Step 3 confirms the fix and Step 5 re-enables the timer. If the canary surfaces a _legitimate_ shrink needing operator reconciliation, leave the worktree until that's resolved.)

---

## Self-Review

**Spec coverage:**

- `pipeline/post-dates.ts` store + 4 helpers, UTC format, existing-wins, atomic write → Task 1. ✓
- `.gitignore` allow-list so the store is committed/durable → Task 1 (Steps 7-8). ✓
- `extract` store-first precedence + freeze info.json dates → Task 2. ✓
- `scrape` persists harvested dates (primary writer) → Task 3. ✓
- Backfill from `dataset.json`, IG-detection via `majorityNumeric`, dedup, idempotent → Task 4. ✓
- Merge IG-only to `main` (preserve UI WIP) → Task 5. ✓
- VM rollout: backfill → commit → re-canary → re-enable timer → Task 6. ✓
- Reproducibility (durable store wins) → Tasks 1-3 constraints + Task 2 test. ✓
- ≤1-day cross-source skew accepted via existing-wins + UTC → Task 1 (`formatTakenAt`, `mergePostDates`). ✓
- Security (no PII/creds in store) → store shape is `{code: date}`; no task writes anything else. ✓
- Re-classification-drift risk → documented in spec; surfaces as a legitimate guard block in Task 6 Step 3 (not this fix's concern). ✓

**Placeholder scan:** none — every code step has complete, copy-pasteable code; every command has expected output.

**Type consistency:** `formatTakenAt(ms): string|null`, `mergePostDates(existing, incoming)`, `loadPostDates(handle)`, `savePostDates(handle, map)` defined in Task 1 and used identically in Tasks 2-4. `postDateOf(store, handle, code)` defined in Task 2, matches its test. `postDatesFromDataset(calls)` defined + tested in Task 4. `majorityNumeric` consumed from the existing `scripts/shortcodes.ts`. Consistent.
