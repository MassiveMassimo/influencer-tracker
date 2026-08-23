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

// Profile reel links include the owning/collaborating profile in the path:
// /<handle>/reel/<shortcode>/. Instagram also loads unrelated reels in GraphQL
// responses, so only DOM links attributed to the requested profile are eligible.
export function profileReelShortcodes(hrefs: string[], handle: string): string[] {
  const target = handle.toLowerCase();
  const seen = new Set<string>();
  for (const href of hrefs) {
    try {
      const url = new URL(href, "https://www.instagram.com");
      const [owner, kind, shortcode] = url.pathname.split("/").filter(Boolean);
      if (owner?.toLowerCase() !== target || kind !== "reel" || !shortcode) continue;
      seen.add(shortcode);
    } catch {
      // Ignore malformed hrefs. They are not proof of target-profile ownership.
    }
  }
  return [...seen];
}

// Decide whether a forward-incremental scroll has caught up to already-harvested reels.
// Reels render newest-first; new reels sit immediately below the (≤3) pinned ones, so a new
// round resets `knownOnlyRounds` before `patience`. After `patience` consecutive rounds with
// no new codes, everything below is already harvested (or there was nothing new today) — stop,
// but only after a known target-profile reel has actually been observed.
export function forwardCaughtUp(args: {
  knownOnlyRounds: number;
  patience: number;
  observedKnown: boolean;
}): boolean {
  return args.observedKnown && args.knownOnlyRounds >= args.patience;
}

export function assertScrapeCoverage(args: {
  seenCount: number;
  forward: boolean;
  observedKnown: boolean;
}): void {
  if (args.seenCount === 0) {
    throw new Error("Instagram scrape observed zero target-profile reels; refusing empty success");
  }
  if (args.forward && !args.observedKnown) {
    throw new Error(
      "Instagram forward scrape never reached a known target-profile reel; coverage is unproven",
    );
  }
}
