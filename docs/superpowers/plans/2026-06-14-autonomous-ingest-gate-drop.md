# Autonomous Ingest: drop the human review gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the VM daily ingest run end-to-end with no human pause — scrape → extract → score → backfill → materialize → parity → revalidate — so a published call needs no upfront review. Human attention is reactive only: the correction loop (already merged) handles errors after someone reports them.

**Architecture:** `ingest.ts` already runs stage-1 (scrape+extract, then stops); `resume.ts` is the complete stage-2 (guard→score→backfill→materialize→parity→revalidate). The gate-drop wires `ingest.ts` to invoke `resume.ts` automatically per active handle, replacing the Telegram "review ping" with a published-summary / blocked-alert. The systemd unit already holds `flock /tmp/influencer-ingest.lock` around the whole run, so `resume.ts` invoked from inside needs no own lock. `guard-no-shrink` (truncation/volume safety) + the `parity-check` gate remain as the only *automated* stops — neither checks call *correctness*; that is the accepted tradeoff, with crowdsourced reports + operator overrides as the post-hoc catch.

**Tech Stack:** Bun, `bun` `$` shell, systemd timer/service, Telegram bot API, Neon Postgres (USE_DB=1).

**Locked decisions (not free choices):**
- **Reuse `resume.ts` as-is, shelled from `ingest.ts`** — DRY. `resume.ts` already encodes the correct stage-2 order (guard BEFORE score overwrites `dataset.json`). Re-implementing it inline in `ingest.ts` would duplicate the sequence and risk drift.
- **Re-score every active handle daily** (not only handles with new calls) — so an override written for a quiet creator auto-applies on the next run, and to-date/recent return horizons mature for everyone. This is what makes the correction loop actually self-healing for low-traffic creators. *(Cheaper alternative: keep the `fresh > 0` gate — see Task 2's note. If chosen, overrides on quiet creators only apply on a manual re-score, partially defeating the loop. Plan as written assumes always-resume.)*
- **Failure never publishes silently.** A `guard-no-shrink` or `parity` failure makes `resume.ts` exit non-zero → `ingest.ts` catches it → Telegram BLOCKED alert with the manual investigation command. The day's bad data for that handle is not advertised as success.
- **The review ping is removed**, replaced by: a per-run published summary (handles + counts) and per-handle BLOCKED/FAILED alerts. The manual `resume.ts` SSH command survives only in the BLOCKED alert (investigation) and as the post-override re-score path.

---

## Task 1: `notify.ts` — replace review ping with published + blocked messages

**Files:**
- Modify: `scripts/notify.ts`
- Test: `scripts/notify.test.ts` (new — pure message builders, no network)

- [ ] **Step 1: Write the failing test** (`scripts/notify.test.ts`):

```ts
import { test, expect } from "bun:test";
import { publishedMessage, blockedMessage } from "./notify";

test("publishedMessage states handle + counts, no SSH review command", () => {
  const m = publishedMessage("theprofinvestor", 4, 2);
  expect(m).toContain("theprofinvestor");
  expect(m).toContain("4");
  expect(m).toContain("2");
  expect(m).not.toContain("calls.review.md"); // no human-review prompt anymore
});

test("blockedMessage names the reason and the manual investigation command", () => {
  const m = blockedMessage("theprofinvestor", "guard: scored 1 << baseline 30");
  expect(m).toContain("theprofinvestor");
  expect(m).toContain("guard: scored 1 << baseline 30");
  expect(m).toContain("resume.ts theprofinvestor"); // operator can re-run after investigating
});
```

- [ ] **Step 2: Run, verify it fails** (`bun test scripts/notify.test.ts`) — "Cannot find module" / missing exports.

- [ ] **Step 3: Implement** — in `scripts/notify.ts`, replace `reviewMessage` with these two builders (keep `notify` unchanged):

```ts
export function publishedMessage(handle: string, newCalls: number, newScored: number): string {
  return `✅ ${handle}: published — ${newCalls} new call(s), ${newScored} newly scored.`;
}
export function blockedMessage(handle: string, reason: string): string {
  return [
    `🚫 ${handle}: ingest BLOCKED — ${reason}`,
    `Investigate, then: ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}"`,
  ].join("\n");
}
```

- [ ] **Step 4: Run, verify pass** (`bun test scripts/notify.test.ts` → 2 pass).
- [ ] **Step 5: Commit.** `git add scripts/notify.ts scripts/notify.test.ts && git commit -m "feat(ops): published/blocked notify messages (drop review ping)"`

## Task 2: `ingest.ts` — auto-resume each active handle

**Files:**
- Modify: `scripts/ingest.ts`

- [ ] **Step 1:** Update the imports: replace `reviewMessage` with `publishedMessage, blockedMessage`.

```ts
import { notify, publishedMessage, blockedMessage } from "./notify";
```

- [ ] **Step 2:** Replace the per-handle body. The current loop pings on `fresh > 0`. New behavior: after scrape+extract, run the full stage-2 via `resume.ts` and report the outcome. Re-score **every** handle (so overrides + return-maturation propagate even with no new calls); a `resume.ts` non-zero exit (guard/parity failure) is caught and alerted, never published as success.

```ts
for (const h of handles) {
  try {
    const before = await counts(h);
    const name = JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    await $`bun run pipeline:x --handle ${h} --name ${name} --forward`;   // stage-1: scrape(forward)+extract
    const after = await counts(h);
    // Stage-2 (the old manual step), now automatic. resume.ts = guard → score → backfill →
    // materialize → parity → revalidate. guard/parity failure throws → BLOCKED alert, no publish.
    // No own flock: the systemd unit already holds /tmp/influencer-ingest.lock around this run.
    await $`bun run scripts/resume.ts ${h}`;
    await notify(publishedMessage(h, after.total - before.total, after.scored - before.scored));
  } catch (e) {
    // guard-no-shrink / parity / scrape / score failure — surfaced, not silently published.
    await notify(blockedMessage(h, (e as Error).message));
  }
}
```

> **Cheaper-alternative note:** to re-score only when there are new calls (the pre-gate-drop behavior, at the cost of overrides not auto-applying for quiet creators), guard the `resume.ts` call with `const after = ...; if (after.total > before.total) { await $\`bun run scripts/resume.ts ${h}\`; await notify(publishedMessage(...)); } else { console.log(\`${h}: no new calls\`); }`. Do NOT implement this unless the always-resume cost is a problem — the locked decision is always-resume.

- [ ] **Step 3:** Confirm `guard-no-shrink` ordering still holds. `resume.ts` runs `guard-no-shrink.ts` FIRST (before `--from prices` rewrites `dataset.json`). The systemd `ExecStart` does `git checkout -- data/` at the start of the run, restoring `dataset.json` to the committed baseline before stage-1 grows `reel-calls.json`, so the guard's `dataset.calls` (baseline) vs scored-`reel-calls` comparison is still like-for-like. No code change — verify by reading `resume.ts` + `guard-no-shrink.ts` and confirming the invariant in a comment if not already clear.

- [ ] **Step 4: Typecheck + tests.** `bunx tsc --noEmit` (clean); `bun test` (no regression). There is no unit test for the loop itself (it's an IO orchestrator); correctness is covered by Task 1's message tests + the reused `resume.ts`/`guard` tests.

- [ ] **Step 5: Commit.** `git add scripts/ingest.ts && git commit -m "feat(ops): auto-resume each handle in ingest (drop manual review gate)"`

## Task 3: systemd — confirm flock + timeout cover the longer run

**Files:**
- Modify (only if needed): `ops/influencer-ingest.service`

- [ ] **Step 1:** Read `ops/influencer-ingest.service`. Confirm `ExecStart` already wraps the whole run in `flock -w 7200 /tmp/influencer-ingest.lock` (it does) — so the internal `resume.ts` calls share the lock; a manual `resume.ts` (held under the same lock) can't race the timer. No flock change needed.
- [ ] **Step 2:** `RuntimeMaxSec=4h` previously covered only scrape+extract. Now each handle also scores+backfills+materializes+parity. Estimate: per-handle stage-2 is minutes (score + a scoped backfill + one global materialize + scoped parity). For a handful of `INGEST_HANDLES`, 4h is ample. **Only if** `INGEST_HANDLES` is large (10+), bump to `RuntimeMaxSec=6h`. Otherwise leave unchanged. Document the reasoning in a comment if you touch it.
- [ ] **Step 3:** Note (no change): `db:materialize` rebuilds the GLOBAL calls-index artifact from the full DB on every handle's resume. With always-resume over N handles, that's N global rebuilds per run. Acceptable (it's a single artifact read+write), but if N is large and this dominates runtime, a future optimization is to materialize once after the loop — out of scope here; `log()` a note in the plan's follow-ups, do not build it now.
- [ ] **Step 4:** If you changed the service file, commit: `git add ops/influencer-ingest.service && git commit -m "ops: raise ingest RuntimeMaxSec for full stage-1+2 run"`. If not, no commit.

## Task 4: Docs — Stage 1+2 are one automated run

**Files:**
- Modify: `ops/README.md`, `CLAUDE.md`

- [ ] **Step 1:** In `CLAUDE.md` "Plan 3b — VM semi-auto ingest" section: update so Stage 1 and Stage 2 are a single **automated** daily run (`ingest.ts` now runs scrape+extract THEN auto-invokes `resume.ts` per handle). The manual `resume.ts` over SSH survives only as (a) the BLOCKED-alert investigation/re-run path and (b) the post-override re-score path. Remove the "pauses and sends a Telegram review ping / Stage 2 (manual, over SSH)" framing; replace with "fully automated; Telegram sends a published summary per handle and a BLOCKED alert on guard/parity failure." Keep the `guard-no-shrink` + parity description (they're the automated gates). State plainly: **no upfront human review of `calls.review.md`; correctness is caught reactively by the report→override correction loop.** Note the always-resume behavior (overrides apply + returns mature for every active handle daily).
- [ ] **Step 2:** In `ops/README.md`: same update to the runbook — the daily timer now publishes without human action; document the published/BLOCKED Telegram messages; keep the manual `resume.ts` command documented for the correction/investigation path. Ensure `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are still listed as required (the run still refuses to start without them).
- [ ] **Step 3:** Update the `extraction-autonomy-findings` decision if referenced: the human gate on the scored subset is now dropped in favor of reactive correction. (Doc only — the memory file is separate; mention in CLAUDE.md that this supersedes the "keep the human gate until precision >95%" stance, now that the correction loop exists as the safety net.)
- [ ] **Step 4: Commit.** `git add CLAUDE.md ops/README.md && git commit -m "docs(ops): ingest is fully automated; review is reactive via the correction loop"`

---

## Self-Review

**Spec coverage:**
- Remove the upfront pause / auto-run stage-2 → Task 2. ✓
- Keep automated guardrails (guard-no-shrink, parity), fail loudly not silently → Task 2 try/catch + Task 1 blockedMessage. ✓
- Replace review ping with published/blocked alerts → Tasks 1, 2. ✓
- flock/timeout cover the longer unattended run → Task 3. ✓
- Docs reflect reactive-only review → Task 4. ✓
- Overrides auto-apply for every active creator (the always-resume decision) → Task 2 (no `fresh>0` gate). ✓

**Type consistency:** `publishedMessage(handle, newCalls, newScored)` / `blockedMessage(handle, reason)` (Task 1) match the call sites in `ingest.ts` (Task 2). `counts()` already returns `{ total, scored }` — unchanged.

**Open items deferred (tracked, not dropped):**
- Materialize-once-after-loop optimization (Task 3 Step 3) — only if N handles makes per-handle global materialize dominate runtime.
- New-creator onboarding stays manual (out of scope; this plan refreshes existing `INGEST_HANDLES` only).
- Classifier-quality prevention (DUOL↔AMD, HIMS FN, BTC over-eager) is the separate Workstream A — this plan ships unreviewed calls and relies on the correction loop to fix them post-hoc. The accepted tradeoff: reactive review only catches what gets seen and flagged; silent errors on low-traffic pages persist in the scorecard.
