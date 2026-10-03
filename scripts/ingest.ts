import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { notifyConfigured, publishedMessage } from "./notify";
import { IngestAlerts, failureReason, sharedFailure } from "./ingest-alerts";

const handles = (process.env.INGEST_HANDLES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!handles.length) {
  console.error("INGEST_HANDLES unset");
  process.exit(1);
}

// Shell out through THIS bun's absolute path, never a bare PATH-dependent `bun` (so a
// manual run from a non-login shell without ~/.bun/bin on PATH still works).
const bun = process.execPath;

if (!notifyConfigured()) {
  console.error(
    "No notify path configured (set HERMES_BIN or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — refusing to run blind (no review pings would be delivered)",
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

// Daily ingest is X-only. An X creator's shortcodes are numeric tweet ids; IG reel codes are
// alphanumeric. If a handle's stored calls are majority non-numeric it is an IG creator wrongly
// listed in INGEST_HANDLES — X-scraping it hits a same-named X account and clobbers the real
// (IG) data with an empty/foreign scrape. Skip it loudly rather than corrupt it.
async function looksInstagram(h: string): Promise<boolean> {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${h}/reel-calls.json`, "utf8")) as {
      shortcode?: unknown;
    }[];
    const codes = rc.map((x) => String(x.shortcode ?? "")).filter(Boolean);
    if (!codes.length) return false;
    const numeric = codes.filter((c) => /^\d+$/.test(c)).length;
    return numeric / codes.length < 0.5;
  } catch {
    return false;
  }
}

// Tracks any handle BLOCK or a failed publish so the process can exit non-zero at the end —
// Failed runs stay failed even when their alert was delivered or deduplicated.
let failed = false;
const alerts = new IngestAlerts("influencer-ingest.service");
await alerts.load();
const ready: { handle: string; newCalls: number; newScored: number }[] = [];

for (const h of handles) {
  try {
    if (await looksInstagram(h)) {
      failed = true;
      await alerts.block(
        h,
        "looks like an Instagram creator (non-numeric shortcodes) — skipped X ingest. Remove it from INGEST_HANDLES.",
      );
      continue;
    }
    const before = await counts(h);
    const name =
      JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    await $`${bun} run pipeline:x --handle ${h} --name ${name} --forward`.quiet();
    const after = await counts(h);
    // Stage-2 (the old manual step), now automatic. resume.ts = guard → score. A guard/score
    // failure throws → BLOCKED alert, no publish. Always-resume: re-scores every active handle so
    // operator overrides + return-maturation apply even when a creator had no new calls.
    // No own flock: the systemd unit already holds /tmp/influencer-ingest.lock around this run.
    await $`${bun} run scripts/resume.ts ${h}`.quiet();
    ready.push({
      handle: h,
      newCalls: after.total - before.total,
      newScored: after.scored - before.scored,
    });
  } catch (e) {
    // scrape / extract / guard-no-shrink / score failure — surfaced, not silently published.
    failed = true;
    const reason = failureReason(e);
    if (sharedFailure(reason)) {
      await alerts.block(
        alerts.unit,
        reason,
        "Repair the X client or throwaway account session, then rerun influencer-ingest.service. Remaining creators were skipped.",
      );
      break;
    }
    await alerts.block(h, reason);
  }
}

// Static-serve model: data/ is the source of truth (serve path reads committed static under
// USE_DB=0). Commit the refreshed datasets/index/prices once and push so Vercel rebuilds and
// serves the fresh static.
let published = true;
if (ready.length) {
  await $`git add data/`;
  const dirty = (await $`git status --porcelain data/`.text()).trim();
  if (dirty) {
    // Identity inline so the commit never depends on the VM's global git config.
    await $`git -c user.name=ingest-bot -c user.email=ingest@imos-vm commit -m ${"data: daily ingest refresh"}`;
    // Absorb any concurrent push to main. A rebase CONFLICT must be aborted, not left half-applied:
    // a mid-rebase working tree wedges the next run's `git pull --ff-only`. Abort
    // leaves the data commit intact locally; the next run retries the publish cleanly.
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
      "ingest",
      `rebase onto origin/main conflicted (aborted); data committed but NOT pushed:\n${rebased.stderr.toString().slice(0, 400)}`,
    );
  } else {
    const pushed = await $`git push origin main`.nothrow();
    if (pushed.exitCode !== 0) {
      failed = true;
      published = false;
      await alerts.block(
        "ingest",
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

// The independent backstop checks the exact completed invocation before sending.
if (failed) process.exit(1);
