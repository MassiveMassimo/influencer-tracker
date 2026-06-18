import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { notify, notifyConfigured, publishedMessage, blockedMessage } from "./notify";

const handles = (process.env.INGEST_HANDLES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!handles.length) { console.error("INGEST_HANDLES unset"); process.exit(1); }

// Shell out through THIS bun's absolute path, never a bare PATH-dependent `bun` (so a
// manual run from a non-login shell without ~/.bun/bin on PATH still works).
const bun = process.execPath;

if (!notifyConfigured()) {
  console.error("No notify path configured (set HERMES_BIN or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID) — refusing to run blind (no review pings would be delivered)");
  process.exit(1);
}

async function counts(h: string) {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${h}/reel-calls.json`, "utf8"));
    return { total: rc.length, scored: rc.filter((x: any) => x.isExplicitBuy && x.direction === "bullish").length };
  } catch { return { total: 0, scored: 0 }; }
}

// Daily ingest is X-only. An X creator's shortcodes are numeric tweet ids; IG reel codes are
// alphanumeric. If a handle's stored calls are majority non-numeric it is an IG creator wrongly
// listed in INGEST_HANDLES — X-scraping it hits a same-named X account and clobbers the real
// (IG) data with an empty/foreign scrape. Skip it loudly rather than corrupt it.
async function looksInstagram(h: string): Promise<boolean> {
  try {
    const rc = JSON.parse(await readFile(`data/creators/${h}/reel-calls.json`, "utf8")) as { shortcode?: unknown }[];
    const codes = rc.map((x) => String(x.shortcode ?? "")).filter(Boolean);
    if (!codes.length) return false;
    const numeric = codes.filter((c) => /^\d+$/.test(c)).length;
    return numeric / codes.length < 0.5;
  } catch { return false; }
}

for (const h of handles) {
  try {
    if (await looksInstagram(h)) {
      await notify(blockedMessage(h, "looks like an Instagram creator (non-numeric shortcodes) — skipped X ingest. Remove it from INGEST_HANDLES."));
      continue;
    }
    const before = await counts(h);
    const name = JSON.parse(await readFile(`data/creators/${h}/dataset.json`, "utf8")).creator?.name ?? h;
    await $`${bun} run pipeline:x --handle ${h} --name ${name} --forward`;   // stage-1: scrape(forward)+extract
    const after = await counts(h);
    // Stage-2 (the old manual step), now automatic. resume.ts = guard → score → backfill →
    // materialize → parity → revalidate. A guard/parity failure throws → BLOCKED alert, no publish.
    // Always-resume: re-scores every active handle so operator overrides + return-maturation apply
    // even when a creator had no new calls.
    // No own flock: the systemd unit already holds /tmp/influencer-ingest.lock around this run.
    await $`${bun} run scripts/resume.ts ${h}`;
    await notify(publishedMessage(h, after.total - before.total, after.scored - before.scored));
  } catch (e) {
    // scrape / extract / guard-no-shrink / score / parity failure — surfaced, not silently published.
    await notify(blockedMessage(h, (e as Error).message));
  }
}
