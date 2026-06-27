import { existsSync, readdirSync } from "node:fs";
import { transcriptsDir } from "./config";

// Shortcodes already harvested + transcribed for a handle. Transcripts are the durable
// per-reel artifact on the VM (they survive the documented raw/+frames/ cleanup), so this
// set is the forward-incremental anchor: a daily run only needs reels newer than these.
export function knownShortcodes(handle: string): Set<string> {
  const dir = transcriptsDir(handle);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length)),
  );
}

// Decide whether a forward-incremental scroll has caught up to already-harvested reels.
// Reels render newest-first; new reels sit immediately below the (≤3) pinned ones, so a new
// round resets `knownOnlyRounds` before `patience`. After `patience` consecutive rounds with
// no new codes, everything below is already harvested (or there was nothing new today) — stop.
// No "saw new first" gate: that would never fire on a zero-new day and scroll the full year.
export function forwardCaughtUp(args: { knownOnlyRounds: number; patience: number }): boolean {
  return args.knownOnlyRounds >= args.patience;
}
