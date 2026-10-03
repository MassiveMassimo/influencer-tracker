import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { notifyConfigured, publishedMessage } from "./notify";
import { IngestAlerts, failureReason, sharedFailure } from "./ingest-alerts";
import { majorityNumeric, loadShortcodes } from "./shortcodes";

// Daily IG ingest. Separate from the X ingest (scripts/ingest.ts) on purpose: the headful
// browser path can hang on a dead IG session. It uses a separate process but shares the
// git/data lock with X. Runs under xvfb with IG_PROXY set (see ops/influencer-ingest-ig.service).
const handles = (process.env.INGEST_HANDLES_IG ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!handles.length) {
  console.error("INGEST_HANDLES_IG unset");
  process.exit(1);
}

// Shell out through THIS bun's absolute path, never a bare PATH-dependent `bun`.
const bun = process.execPath;

// IG recovery differs from X: a BLOCK is usually a dead/challenged session, which needs a manual
// VNC re-login before any re-run. Pass this as blockedMessage's recovery override so the alert
// carries the right steps (the default command is X-only).
const igRecovery = (h: string) =>
  `If the IG session died/challenged, re-login the .chrome-profile via VNC (through the proxy) first, then:\n` +
  `ssh ubuntu@imos-vm "cd ~/influencer-tracker && flock /tmp/influencer-ingest.lock bash -c 'INGEST_HANDLES_IG=${h} xvfb-run -a bun run scripts/ingest-ig.ts'"`;

if (!notifyConfigured()) {
  console.error(
    "No notify path configured (set HERMES_BIN or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — refusing to run blind",
  );
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

// Failed runs stay failed even when their alert was delivered or deduplicated.
let failed = false;
const alerts = new IngestAlerts("influencer-ingest-ig.service");
await alerts.load();
const ready: { handle: string; newCalls: number; newScored: number }[] = [];

for (const h of handles) {
  try {
    // Inverse of ingest.ts's looksInstagram: skip an X creator wrongly listed here. Scraping IG
    // for a numeric-shortcode (X) handle would hit instagram.com/<h> and clobber real X data.
    if (majorityNumeric(await loadShortcodes(h))) {
      failed = true;
      await alerts.block(
        h,
        "looks like an X creator (numeric shortcodes) — skipped IG ingest. Remove it from INGEST_HANDLES_IG.",
        "Edit INGEST_HANDLES_IG in the VM .env to drop this handle.",
      );
      continue;
    }
    const before = await counts(h);
    const name =
      JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    // Stage-1: scrape(forward) + transcribe + frames + extract (idempotent stages skip done work).
    // run.ts pauses after extract; we resume explicitly below (no human review — ship-then-correct).
    await $`${bun} run pipeline --handle ${h} --name ${name} --forward`.quiet();
    const after = await counts(h);
    // Stage-2: guard-no-shrink → prices + score (platform-agnostic). A guard/score failure throws
    // → BLOCKED alert, no publish for this handle. Always-resume so overrides + return-maturation
    // apply even when a creator had no new reels.
    await $`${bun} run scripts/resume.ts ${h} ig`.quiet();
    ready.push({
      handle: h,
      newCalls: after.total - before.total,
      newScored: after.scored - before.scored,
    });
  } catch (e) {
    // scrape (incl. "IG session rejected … re-login via VNC" + proxy-egress abort) / extract /
    // guard / score failure — surfaced, never silently published.
    failed = true;
    const reason = failureReason(e);
    if (sharedFailure(reason)) {
      await alerts.block(alerts.unit, reason, igRecovery(h) + "\nRemaining creators were skipped.");
      break;
    }
    await alerts.block(h, reason, igRecovery(h));
  }
}

// Static-serve: data/ is the source of truth. Commit + push once so Vercel rebuilds the static.
let published = true;
if (ready.length) {
  await $`git add data/`;
  const dirty = (await $`git status --porcelain data/`.text()).trim();
  if (dirty) {
    await $`git -c user.name=ingest-bot -c user.email=ingest@imos-vm commit -m ${"data: daily IG ingest refresh"}`;
    // Absorb a concurrent push (the X timer also pushes). Abort a conflicted rebase rather than
    // leaving a half-applied tree that would wedge the next run's git pull --ff-only.
  }
}
// Retry an earlier unpublished data commit even if this run generated no new diff.
const ahead = Number((await $`git rev-list --count origin/main..HEAD`.text()).trim());
if (ahead > 0) {
  const rebased = await $`git pull --rebase origin main`.nothrow();
  if (rebased.exitCode !== 0) {
    await $`git rebase --abort`.nothrow();
    failed = true;
    published = false;
    await alerts.block(
      "ingest-ig",
      `rebase onto origin/main conflicted (aborted); data committed but NOT pushed:\n${rebased.stderr.toString().slice(0, 400)}`,
    );
  } else {
    const pushed = await $`git push origin main`.nothrow();
    if (pushed.exitCode !== 0) {
      failed = true;
      published = false;
      await alerts.block(
        "ingest-ig",
        `data committed but push failed:\n${pushed.stderr.toString().slice(0, 400)}`,
      );
    }
  }
}
if (published) {
  for (const item of ready) {
    await alerts.published(
      item.handle,
      publishedMessage(item.handle, item.newCalls, item.newScored),
    );
  }
}
if (!(await alerts.complete(undefined, !failed))) failed = true;

if (failed) process.exit(1);
