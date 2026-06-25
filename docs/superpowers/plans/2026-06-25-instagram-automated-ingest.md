# Instagram Automated Daily Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three Instagram creators refresh automatically every day on the VM, mirroring the X daily ingest, while keeping the fragile IG browser path isolated from the reliable X path.

**Architecture:** A separate IG entrypoint (`scripts/ingest-ig.ts`) + a second staggered systemd timer drive the existing IG pipeline (`pipeline/run.ts`) in forward-incremental mode, auto-resuming past the human-review pause exactly like X. New code is small and pure where it matters (forward-scroll stop decision, platform guard, pipeline selection); the heavy stages (`scrape`/`transcribe`/`frames`/`extract`/`prices`/`score`) are reused unchanged.

**Tech Stack:** Bun + TypeScript, Playwright (headful Chrome under xvfb), `bun:test`, systemd timers, the iProyal SOCKS5 residential proxy.

## Global Constraints

- **Worktree:** all work happens in the `ig-ingest` worktree at `../influencer-tracker-ig-ingest`; never edit on `main`. Build/typecheck/test in the worktree; VM deploy + verification after merge to `main`.
- **Tests:** `bun test`. Typecheck: `bunx tsc --noEmit`. The `#/` alias maps to `src/`.
- **Cadence:** daily, IG timer staggered to **14:00 UTC** (X timer is 13:00 UTC) so the two git pushes do not race.
- **Isolation:** do not modify `scripts/ingest.ts`, `pipeline/run-x.ts`, or `pipeline/x/*` (the X path stays untouched). `scripts/resume.ts` gains only an additive, default-preserving platform argument.
- **Ship-then-correct:** no human review gate before publish; the report→override loop is the safety net (same posture as X).
- **Burner security:** `imtiddies` `cookies.txt` + `.chrome-profile` are credential-equivalent — stay gitignored and `chmod 600` on the VM. Never log cookie bytes.
- **Static-serve:** `data/` is the source of truth; publish = git commit + push (no DB sync/parity/revalidate).
- **IG handles env:** `INGEST_HANDLES_IG=kevvonz,roadto100kportfolio,johnnylixf`.

---

### Task 1: Forward-scroll stop helper (pure, testable)

The IG scrape scrolls the `/reels/` page back 12 months every run. For a daily incremental run we stop once we have caught up to reels we already harvested. Both functions are pure/fs-only and live in their own module (no Playwright import) so the test is fast and offline.

**Files:**
- Create: `pipeline/scrape-forward.ts`
- Test: `pipeline/scrape-forward.test.ts`

**Interfaces:**
- Consumes: `transcriptsDir` from `pipeline/config.ts`.
- Produces:
  - `knownShortcodes(handle: string): Set<string>` — shortcodes that already have a transcript on disk (the forward anchor).
  - `forwardCaughtUp(args: { sawAnyNew: boolean; knownOnlyRounds: number; patience: number }): boolean` — true when the forward scroll has reached already-harvested reels.

- [ ] **Step 1: Write the failing test**

```ts
// pipeline/scrape-forward.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { forwardCaughtUp } from "./scrape-forward";

test("forwardCaughtUp: stops only after a new code then patience known-only rounds", () => {
  // not yet seen anything new -> never stop (pinned-reel guard)
  expect(forwardCaughtUp({ sawAnyNew: false, knownOnlyRounds: 9, patience: 2 })).toBe(false);
  // saw new, but not enough known-only rounds yet
  expect(forwardCaughtUp({ sawAnyNew: true, knownOnlyRounds: 1, patience: 2 })).toBe(false);
  // saw new and patience reached -> caught up
  expect(forwardCaughtUp({ sawAnyNew: true, knownOnlyRounds: 2, patience: 2 })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test pipeline/scrape-forward.test.ts`
Expected: FAIL — `Cannot find module './scrape-forward'` (or `forwardCaughtUp is not a function`).

- [ ] **Step 3: Write minimal implementation**

```ts
// pipeline/scrape-forward.ts
import { existsSync, readdirSync } from "node:fs";
import { transcriptsDir } from "./config";

// Shortcodes already harvested + transcribed for a handle. Transcripts are the durable
// per-reel artifact on the VM (they survive the documented raw/+frames/ cleanup), so this
// set is the forward-incremental anchor: a daily run only needs reels newer than these.
export function knownShortcodes(handle: string): Set<string> {
  const dir = transcriptsDir(handle);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)),
  );
}

// Decide whether a forward-incremental scroll has caught up to already-harvested reels.
// Reels render newest-first, so once we have seen at least one NEW code and then go
// `patience` consecutive rounds finding no further new codes, everything below is already
// harvested — stop. Requiring a new code first avoids stopping on pinned reels (old codes
// pinned to the top, out of date order).
export function forwardCaughtUp(args: {
  sawAnyNew: boolean;
  knownOnlyRounds: number;
  patience: number;
}): boolean {
  return args.sawAnyNew && args.knownOnlyRounds >= args.patience;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test pipeline/scrape-forward.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `knownShortcodes` fs test**

```ts
// append to pipeline/scrape-forward.test.ts
import { knownShortcodes } from "./scrape-forward";
import { DATA } from "./config";

test("knownShortcodes: reads transcript basenames, empty when dir missing", () => {
  const handle = `__test_known_${Date.now()}`;
  const dir = join(DATA, handle, "transcripts");
  // missing dir -> empty
  expect(knownShortcodes(handle).size).toBe(0);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "ABC123.json"), "{}");
    writeFileSync(join(dir, "DEF456.json"), "{}");
    writeFileSync(join(dir, "notjson.txt"), "x");
    const got = knownShortcodes(handle);
    expect(got.has("ABC123")).toBe(true);
    expect(got.has("DEF456")).toBe(true);
    expect(got.has("notjson")).toBe(false);
    expect(got.size).toBe(2);
  } finally {
    rmSync(join(DATA, handle), { recursive: true, force: true });
  }
});
```

(`knownShortcodes` reads under `transcriptsDir`, which is `data/creators/<handle>/transcripts`, so the test writes under a throwaway handle in `DATA` and cleans up.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test pipeline/scrape-forward.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add pipeline/scrape-forward.ts pipeline/scrape-forward.test.ts
git commit -m "feat(scrape): forward-incremental stop helper + transcript anchor"
```

---

### Task 2: Wire forward mode into `scrape()` and `run.ts`

Add an opts-based `forward` flag to the IG scraper and have it stop early via the Task 1 helper; thread `--forward` from `run.ts`. The only caller of `scrape()` is `run.ts:27` (verified), so the signature change is safe. No unit test (browser-driven); verified on the VM in Task 7.

**Files:**
- Modify: `pipeline/scrape.ts` (signature at `:92`; scroll loop at `:150-159`)
- Modify: `pipeline/run.ts:27`

**Interfaces:**
- Consumes: `knownShortcodes`, `forwardCaughtUp` from Task 1.
- Produces: `scrape(handle: string, months?: number, opts?: { forward?: boolean }): Promise<string[]>` (was `scrape(handle, months?, userDataDir?)`).

- [ ] **Step 1: Add the import to `pipeline/scrape.ts`**

Add near the other local imports at the top of `pipeline/scrape.ts`:

```ts
import { knownShortcodes, forwardCaughtUp } from "./scrape-forward";
```

- [ ] **Step 2: Change the signature (replace line 92)**

Replace:

```ts
export async function scrape(handle: string, months = 12, userDataDir = ".chrome-profile") {
```

with:

```ts
export async function scrape(handle: string, months = 12, opts: { forward?: boolean } = {}) {
  const userDataDir = ".chrome-profile";
```

(The old 3rd positional `userDataDir` was only ever called with its default; it becomes an internal const.)

- [ ] **Step 3: Replace the scroll loop (lines 150-159)**

Replace:

```ts
  // Human-like scroll until we pass the cutoff date or stop finding new reels.
  let stagnant = 0;
  while (stagnant < 4) {
    const before = seen.size;
    await page.mouse.wheel(0, 1200 + jitter(0, 800));
    await sleep(jitter(1500, 3500));
    const oldest = Math.min(...[...seen.values()].filter(Boolean), Date.now());
    if (oldest < cutoff) break;
    stagnant = seen.size === before ? stagnant + 1 : 0;
  }
```

with:

```ts
  // Human-like scroll until we pass the cutoff, stop finding new reels, or (forward mode)
  // catch up to already-harvested reels. Forward mode keeps the daily scroll footprint
  // small — both a speed win and a lower bot signature at daily cadence.
  const known = opts.forward ? knownShortcodes(handle) : new Set<string>();
  const countNew = () => [...seen.keys()].filter((c) => !known.has(c)).length;
  let stagnant = 0, sawAnyNew = false, knownOnlyRounds = 0;
  while (stagnant < 4) {
    const before = seen.size;
    const newBefore = countNew();
    await page.mouse.wheel(0, 1200 + jitter(0, 800));
    await sleep(jitter(1500, 3500));
    if (countNew() > newBefore) { sawAnyNew = true; knownOnlyRounds = 0; }
    else knownOnlyRounds++;
    if (opts.forward && forwardCaughtUp({ sawAnyNew, knownOnlyRounds, patience: 2 })) {
      console.log(`>>> forward scrape: caught up to known reels (${countNew()} new)`);
      break;
    }
    const oldest = Math.min(...[...seen.values()].filter(Boolean), Date.now());
    if (oldest < cutoff) break;
    stagnant = seen.size === before ? stagnant + 1 : 0;
  }
```

- [ ] **Step 4: Thread `--forward` through `run.ts` (replace line 27)**

Replace `pipeline/run.ts:27`:

```ts
    const codes = await scrape(handle);
```

with:

```ts
    const codes = await scrape(handle, 12, { forward: "forward" in args });
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0 (no type errors).

- [ ] **Step 6: Commit**

```bash
git add pipeline/scrape.ts pipeline/run.ts
git commit -m "feat(scrape): --forward incremental mode for the IG pipeline"
```

---

### Task 3: IG platform guard (pure, testable)

`ingest-ig.ts` must skip any handle wrongly listed that is actually an X creator (numeric tweet-id shortcodes) — the inverse of `ingest.ts`'s `looksInstagram`. The pure predicate lives in its own module so both the guard and its test stay simple. `ingest.ts` (the X path) is intentionally NOT modified.

**Files:**
- Create: `scripts/shortcodes.ts`
- Test: `scripts/shortcodes.test.ts`

**Interfaces:**
- Produces:
  - `majorityNumeric(codes: string[]): boolean` — true when the majority of shortcodes are all-digits (an X creator).
  - `loadShortcodes(handle: string): Promise<string[]>` — shortcodes from a creator's committed `reel-calls.json` (empty on any read/parse error).

- [ ] **Step 1: Write the failing test**

```ts
// scripts/shortcodes.test.ts
import { test, expect } from "bun:test";
import { majorityNumeric } from "./shortcodes";

test("majorityNumeric: X tweet ids vs IG reel codes", () => {
  expect(majorityNumeric(["2068305592083423341", "1973870591154565292"])).toBe(true);
  expect(majorityNumeric(["DVwrHDSEWGm", "DOPcBQAD6Qo", "DLsPCEgR4p-"])).toBe(false);
  // mixed: 1 numeric of 3 -> not majority numeric (treat as IG)
  expect(majorityNumeric(["123456", "DVwrHDSEWGm", "DOPcBQAD6Qo"])).toBe(false);
  // empty -> false (no signal; do not skip)
  expect(majorityNumeric([])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/shortcodes.test.ts`
Expected: FAIL — `Cannot find module './shortcodes'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/shortcodes.ts
import { readFile } from "node:fs/promises";

// True when the majority of shortcodes are all-digits — i.e. X tweet ids, not IG reel codes.
// Used by ingest-ig.ts to skip an X creator wrongly listed in INGEST_HANDLES_IG (mirror of
// ingest.ts's looksInstagram, which guards the opposite direction). Empty/no-signal -> false.
export function majorityNumeric(codes: string[]): boolean {
  if (!codes.length) return false;
  const numeric = codes.filter((c) => /^\d+$/.test(c)).length;
  return numeric / codes.length >= 0.5;
}

export async function loadShortcodes(handle: string): Promise<string[]> {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${handle}/reel-calls.json`, "utf8")) as {
      shortcode?: unknown;
    }[];
    return rc.map((x) => String(x.shortcode ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/shortcodes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/shortcodes.ts scripts/shortcodes.test.ts
git commit -m "feat(ingest): IG platform guard predicate (majorityNumeric)"
```

---

### Task 4: Platform-aware `resume.ts`

`resume.ts` runs guard → prices+score. prices/score are platform-agnostic; only the pipeline npm script differs (`pipeline:x` vs `pipeline`). Add an optional 2nd CLI arg selecting the platform, defaulting to X so the existing X behavior is byte-identical. The selection is a pure helper so it is unit-tested.

**Files:**
- Create: `scripts/pipeline-for.ts`
- Test: `scripts/pipeline-for.test.ts`
- Modify: `scripts/resume.ts`

**Interfaces:**
- Produces: `pipelineFor(platform?: string): "pipeline" | "pipeline:x"` — `"ig"` → `"pipeline"`, anything else (incl. undefined) → `"pipeline:x"`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/pipeline-for.test.ts
import { test, expect } from "bun:test";
import { pipelineFor } from "./pipeline-for";

test("pipelineFor: ig selects IG pipeline, default stays X", () => {
  expect(pipelineFor("ig")).toBe("pipeline");
  expect(pipelineFor("x")).toBe("pipeline:x");
  expect(pipelineFor(undefined)).toBe("pipeline:x");
  expect(pipelineFor("")).toBe("pipeline:x");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/pipeline-for.test.ts`
Expected: FAIL — `Cannot find module './pipeline-for'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/pipeline-for.ts
// Select the pipeline npm script for resume's prices+score stages. prices/score are
// platform-agnostic; only the orchestrator differs. Default is X so the existing X
// resume path is unchanged.
export function pipelineFor(platform?: string): "pipeline" | "pipeline:x" {
  return platform === "ig" ? "pipeline" : "pipeline:x";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test scripts/pipeline-for.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `scripts/resume.ts`**

Replace the body of `scripts/resume.ts` with (preserving its existing comments, adding the platform arg):

```ts
import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { pipelineFor } from "./pipeline-for";
const handle = process.argv[2];
const platform = process.argv[3]; // "ig" | "x" | undefined (default x)
if (!handle) { console.error("usage: resume <handle> [ig|x]"); process.exit(1); }
// Invoke nested stages through THIS bun's absolute path (process.execPath), not a bare
// `bun` that depends on PATH. The systemd unit sets PATH, but a manual run over a
// non-login SSH shell has no ~/.bun/bin on PATH, so a bare nested `bun` would fail.
const bun = process.execPath;
const pipeline = pipelineFor(platform);
// 1. Guard against a truncated scrape BEFORE score overwrites the committed baseline.
await $`${bun} run scripts/guard-no-shrink.ts ${handle}`;
// 2. Score (reads name from the committed dataset so updateIndex doesn't rename the creator).
//    score applies operator overrides (db/overrides.ts, fail-open) before writing dataset.json.
//    prices+score are platform-agnostic; the IG and X orchestrators expose the same --from prices.
const name = JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8")).creator?.name ?? handle;
await $`${bun} run ${pipeline} --handle ${handle} --name ${name} --from prices`;
// Static-serve: ingest commits + pushes data/ once after all handles (redeploys Vercel).
```

- [ ] **Step 6: Verify X resume path is unchanged + typecheck**

Run: `bunx tsc --noEmit && bun test scripts/pipeline-for.test.ts`
Expected: tsc exit 0; test PASS. (`resume.ts <handle>` with no 2nd arg still selects `pipeline:x`.)

- [ ] **Step 7: Commit**

```bash
git add scripts/pipeline-for.ts scripts/pipeline-for.test.ts scripts/resume.ts
git commit -m "feat(resume): optional platform arg, default unchanged (X)"
```

---

### Task 5: `scripts/ingest-ig.ts` daily entrypoint

Mirror `scripts/ingest.ts`, but for IG: read `INGEST_HANDLES_IG`, skip X-looking handles via the Task 3 guard, run the IG pipeline forward, auto-resume (guard → prices+score), then one commit+push. Reuses `notify.ts` verbatim. No unit test for the composed script (it shells out to the full pipeline); verified on the VM in Task 7.

**Files:**
- Create: `scripts/ingest-ig.ts`

**Interfaces:**
- Consumes: `majorityNumeric`, `loadShortcodes` (Task 3); `notify`, `notifyConfigured`, `publishedMessage`, `blockedMessage` from `scripts/notify.ts`; the `pipeline` npm script (IG `run.ts`); `scripts/resume.ts <handle> ig` (Task 4).

- [ ] **Step 1: Write the script**

```ts
// scripts/ingest-ig.ts
import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { notify, notifyConfigured, publishedMessage, blockedMessage } from "./notify";
import { majorityNumeric, loadShortcodes } from "./shortcodes";

// Daily IG ingest. Separate from the X ingest (scripts/ingest.ts) on purpose: the headful
// browser path can hang on a dead IG session, so it must never share a process/lock with the
// reliable X run. Runs under xvfb with IG_PROXY set (see ops/influencer-ingest-ig.service).
const handles = (process.env.INGEST_HANDLES_IG ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!handles.length) { console.error("INGEST_HANDLES_IG unset"); process.exit(1); }

// Shell out through THIS bun's absolute path, never a bare PATH-dependent `bun`.
const bun = process.execPath;

if (!notifyConfigured()) {
  console.error("No notify path configured (set HERMES_BIN or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — refusing to run blind");
  process.exit(1);
}

async function counts(h: string) {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${h}/reel-calls.json`, "utf8"));
    return { total: rc.length, scored: rc.filter((x: any) => x.isExplicitBuy && x.direction === "bullish").length };
  } catch { return { total: 0, scored: 0 }; }
}

// Tracks any handle BLOCK / failed publish so the process exits non-zero for the systemd
// OnFailure dead-man (notify() is best-effort and could itself be down).
let failed = false;

for (const h of handles) {
  try {
    // Inverse of ingest.ts's looksInstagram: skip an X creator wrongly listed here. Scraping IG
    // for a numeric-shortcode (X) handle would hit instagram.com/<h> and clobber real X data.
    if (majorityNumeric(await loadShortcodes(h))) {
      await notify(blockedMessage(h, "looks like an X creator (numeric shortcodes) — skipped IG ingest. Remove it from INGEST_HANDLES_IG."));
      continue;
    }
    const before = await counts(h);
    const name = JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    // Stage-1: scrape(forward) + transcribe + frames + extract (idempotent stages skip done work).
    // run.ts pauses after extract; we resume explicitly below (no human review — ship-then-correct).
    await $`${bun} run pipeline --handle ${h} --name ${name} --forward`;
    const after = await counts(h);
    // Stage-2: guard-no-shrink → prices + score (platform-agnostic). A guard/score failure throws
    // → BLOCKED alert, no publish for this handle. Always-resume so overrides + return-maturation
    // apply even when a creator had no new reels.
    await $`${bun} run scripts/resume.ts ${h} ig`;
    await notify(publishedMessage(h, after.total - before.total, after.scored - before.scored));
  } catch (e) {
    // scrape (incl. "IG session rejected … re-login via VNC" + proxy-egress abort) / extract /
    // guard / score failure — surfaced, never silently published.
    failed = true;
    await notify(blockedMessage(h, (e as Error).message));
  }
}

// Static-serve: data/ is the source of truth. Commit + push once so Vercel rebuilds the static.
await $`git add data/`.nothrow();
const dirty = (await $`git status --porcelain data/`.text()).trim();
if (dirty) {
  await $`git -c user.name=ingest-bot -c user.email=ingest@imos-vm commit -m ${"data: daily IG ingest refresh"}`.nothrow();
  // Absorb a concurrent push (the X timer also pushes). Abort a conflicted rebase rather than
  // leaving a half-applied tree that would wedge the next run's git pull --ff-only.
  const rebased = await $`git pull --rebase origin main`.nothrow();
  if (rebased.exitCode !== 0) {
    await $`git rebase --abort`.nothrow();
    failed = true;
    await notify(blockedMessage("ingest-ig", `rebase onto origin/main conflicted (aborted); data committed but NOT pushed:\n${rebased.stderr.toString().slice(0, 400)}`));
  } else {
    const pushed = await $`git push origin main`.nothrow();
    if (pushed.exitCode !== 0) {
      failed = true;
      await notify(blockedMessage("ingest-ig", `data committed but push failed:\n${pushed.stderr.toString().slice(0, 400)}`));
    }
  }
} else {
  console.log("[ingest-ig] no data/ changes to publish");
}

if (failed) process.exit(1);
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Smoke-check the guard path offline (no network)**

Run (asserts the script refuses with no handles, proving arg wiring without scraping):

```bash
INGEST_HANDLES_IG="" bun run scripts/ingest-ig.ts; echo "exit=$?"
```

Expected: prints `INGEST_HANDLES_IG unset` and `exit=1`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-ig.ts
git commit -m "feat(ingest): scripts/ingest-ig.ts daily Instagram entrypoint"
```

---

### Task 6: systemd units + ops docs

A second timer, staggered to 14:00 UTC, runs `ingest-ig.ts` under `xvfb-run` (the VM is headless; `scrape()` launches `headless:false`) with its own flock. Committed to the repo like the X units; installed on the VM in Task 7.

**Files:**
- Create: `ops/influencer-ingest-ig.service`
- Create: `ops/influencer-ingest-ig.timer`
- Modify: `ops/README.md` (document the IG timer + `INGEST_HANDLES_IG`)

- [ ] **Step 1: Write the service unit**

```ini
# ops/influencer-ingest-ig.service
[Unit]
Description=influencer-tracker daily ingest (Instagram, forward incremental, headful via xvfb)
OnFailure=notify-fail.service
[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/home/ubuntu/influencer-tracker
EnvironmentFile=/home/ubuntu/influencer-tracker/.env
Environment=PATH=/home/ubuntu/.bun/bin:/usr/local/bin:/usr/bin:/bin
# IG scrape downloads + transcribes new reels (Parakeet CPU) — allow generous wall time.
RuntimeMaxSec=4h
# Separate lock from the X ingest so the fragile browser run never blocks/clobbers X.
# clean -fd data/ (no -x) is safe: .gitignore shields seeded per-creator state (raw/, frames/,
# transcripts/, cookies.txt). xvfb-run gives the headful Chrome a virtual display; IG_PROXY
# (from .env) routes egress through the residential relay so the burner is never seen from the
# datacenter IP (scrape() aborts loudly if the proxy egress check fails).
ExecStart=/usr/bin/flock -w 7200 /tmp/influencer-ingest-ig.lock bash -c 'git checkout -- data/ && git clean -fd data/ && git pull --ff-only && xvfb-run -a bun run scripts/ingest-ig.ts'
```

- [ ] **Step 2: Write the timer unit**

```ini
# ops/influencer-ingest-ig.timer
[Unit]
Description=daily influencer-tracker Instagram ingest
[Timer]
# Staggered 1h after the X ingest (13:00 UTC) so the two git pushes do not race.
OnCalendar=*-*-* 14:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Document in `ops/README.md`**

Add a short section after the existing ingest documentation:

```markdown
## Instagram daily ingest (separate timer)

`influencer-ingest-ig.{service,timer}` refresh the IG creators (`INGEST_HANDLES_IG`)
daily at 14:00 UTC — staggered 1h after the X ingest so the two pushes do not race.
The service runs `scripts/ingest-ig.ts` under `xvfb-run` (headful Chrome needs a
display) with `IG_PROXY` set (residential egress; the burner is never seen from the
datacenter IP). It scrapes forward-incrementally (only reels newer than the durable
transcript anchor), auto-resumes past the review pause (ship-then-correct), and
commits+pushes `data/` once.

**Required `.env` keys:** `INGEST_HANDLES_IG=kevvonz,roadto100kportfolio,johnnylixf`,
`IG_PROXY=socks5://127.0.0.1:1081` (already set).

**Session death is manual to recover:** when IG expires/challenges the `imtiddies`
session, the run sends a BLOCKED alert and the creator stays at last-good data.
Re-login the `.chrome-profile` via VNC through the proxy, then the next run recovers.

Install (one-time): copy both units into `/etc/systemd/system/`,
`sudo systemctl daemon-reload && sudo systemctl enable --now influencer-ingest-ig.timer`.
```

- [ ] **Step 4: Commit**

```bash
git add ops/influencer-ingest-ig.service ops/influencer-ingest-ig.timer ops/README.md
git commit -m "ops: IG daily ingest systemd units + README"
```

---

### Task 7: Merge to main + VM deploy + verification

Build/typecheck/test pass in the worktree → merge to `main` → deploy on the VM. Per the project workflow, the VM runs against `main`; the new units + scripts must be on `main` for the timer to use them.

- [ ] **Step 1: Full verification in the worktree**

Run: `bunx tsc --noEmit && bun test`
Expected: tsc exit 0; all tests pass (the 4 new tests included), 0 failures.

- [ ] **Step 2: Merge to main (from the PRIMARY checkout, not the worktree)**

```bash
# in /Users/imo/Documents/GitHub/influencer-tracker (main)
git fetch origin && git merge --ff-only origin/main   # sync local main to origin first
git merge --no-ff ig-ingest -m "merge(ig-ingest): automated daily Instagram ingest"
git push origin main
```

Expected: clean merge, push succeeds. (If `--ff-only` to origin fails because origin moved, rebase `ig-ingest` onto `origin/main` in the worktree first, re-run Step 1, then merge.)

- [ ] **Step 3: Pull on the VM + set the env var**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && git checkout -- data/ && git pull --ff-only && grep -q INGEST_HANDLES_IG .env || echo "INGEST_HANDLES_IG=kevvonz,roadto100kportfolio,johnnylixf" >> .env && grep INGEST_HANDLES_IG .env'
```

Expected: pull succeeds; `.env` shows the IG handles line.

- [ ] **Step 4: Verify burner credential perms (security gate)**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && for h in kevvonz roadto100kportfolio johnnylixf; do f=data/creators/$h/cookies.txt; [ -f "$f" ] && { chmod 600 "$f"; stat -c "%a %n" "$f"; }; done; chmod 700 .chrome-profile 2>/dev/null; stat -c "%a %n" .chrome-profile; git check-ignore data/creators/kevvonz/cookies.txt && echo "cookies gitignored OK"'
```

Expected: each `cookies.txt` is `600`, `.chrome-profile` `700`, and cookies are gitignored.

- [ ] **Step 5: Install + enable the IG timer**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && sudo cp ops/influencer-ingest-ig.service ops/influencer-ingest-ig.timer /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now influencer-ingest-ig.timer && systemctl list-timers influencer-ingest-ig.timer --all'
```

Expected: timer is enabled and lists a next-fire at 14:00 UTC.

- [ ] **Step 6: Manual dry-run of one canary handle (proves the whole chain)**

Run one handle by hand under the same env the service uses, watching for the forward scrape, auto-resume, and a clean (or BLOCKED) outcome — without waiting for the timer:

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && flock -w 60 /tmp/influencer-ingest-ig.lock bash -c "INGEST_HANDLES_IG=roadto100kportfolio xvfb-run -a /home/ubuntu/.bun/bin/bun run scripts/ingest-ig.ts" 2>&1 | tail -40'
```

Expected: forward scrape logs the egress IP + "caught up to known reels" (or harvests new reels), resume runs guard+score, and it prints a published summary (or a BLOCKED alert if the session needs VNC re-auth — in which case follow the runbook and re-run).

- [ ] **Step 7: Confirm freshness + git publish**

```bash
ssh ubuntu@imos-vm 'cd ~/influencer-tracker && node -e "const d=require(\"./data/creators/roadto100kportfolio/dataset.json\");console.log(\"generatedAt:\",d.generatedAt,\"scored:\",d.calls.length)"; git log --oneline -1'
```

Expected: `generatedAt` is today; if there were changes, the last commit is `data: daily IG ingest refresh` and was pushed (Vercel redeploys).

- [ ] **Step 8: Remove the worktree (after merge confirmed)**

```bash
# from the primary checkout
git worktree remove ../influencer-tracker-ig-ingest
git branch -d ig-ingest   # only after the merge is on origin/main
```

---

## Self-Review

**Spec coverage:**
- Separate IG path + timer (approach A) → Tasks 5, 6. ✓
- Forward-scroll bound w/ transcript anchor + pinned-reel guard + fallback → Tasks 1, 2. ✓
- Auto-resume past PAUSE (ship-then-correct) → Task 5 (resume call, no review). ✓
- Session-death / proxy-egress → BLOCKED alert, last-good data → Task 5 try/catch (errors already thrown by `scrape.ts`). ✓
- guard-no-shrink before score → Task 4 (reused in resume). ✓
- Platform guard (skip X handle) → Tasks 3, 5. ✓
- Daily staggered timer, xvfb, IG_PROXY, own flock, exit-nonzero dead-man → Task 6. ✓
- Cost (text-only re-extract, no cursor) → no code (YAGNI), documented. ✓
- Security (cookies/profile perms, gitignore) → Task 7 Step 4. ✓
- Testing (guard, forward helper, resume default) → Tasks 1, 3, 4. ✓

**Placeholder scan:** none — every code step has complete, copy-pasteable code.

**Type consistency:** `scrape(handle, months, {forward})` defined in Task 2, called identically in `run.ts`; `forwardCaughtUp`/`knownShortcodes` defined Task 1, imported Task 2; `majorityNumeric`/`loadShortcodes` defined Task 3, used Task 5; `pipelineFor` defined Task 4, used in `resume.ts`. Consistent.
