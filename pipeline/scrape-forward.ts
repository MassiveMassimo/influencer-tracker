import { existsSync, readdirSync } from "node:fs";
import { transcriptsDir } from "./config";

// Shortcodes already harvested + transcribed for a handle. Transcripts are the durable
// per-post artifact on the VM (they survive the documented raw/+frames/ cleanup), so this
// set is the forward-incremental anchor: a daily run only needs posts newer than these.
export function knownShortcodes(handle: string): Set<string> {
  const dir = transcriptsDir(handle);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length)),
  );
}

export interface ProfileMediaRef {
  shortcode: string;
  kind: "reel" | "post";
}

// Profile media links include the owning/collaborating profile in the path:
// /<handle>/(reel|p)/<shortcode>/. Instagram also loads unrelated media in
// GraphQL responses, so only DOM links attributed to the requested profile qualify.
export function profileMediaFromHrefs(hrefs: string[], handle: string): ProfileMediaRef[] {
  const target = handle.toLowerCase();
  const seen = new Set<string>();
  const media: ProfileMediaRef[] = [];
  for (const href of hrefs) {
    try {
      const url = new URL(href, "https://www.instagram.com");
      const [owner, kind, shortcode] = url.pathname.split("/").filter(Boolean);
      if (
        owner?.toLowerCase() !== target ||
        (kind !== "reel" && kind !== "p") ||
        !shortcode ||
        seen.has(shortcode)
      )
        continue;
      seen.add(shortcode);
      media.push({ shortcode, kind: kind === "reel" ? "reel" : "post" });
    } catch {
      // Ignore malformed hrefs. They are not proof of target-profile ownership.
    }
  }
  return media;
}

// Decide whether a forward-incremental scroll has caught up to already-harvested posts.
// Posts render newest-first; new posts sit immediately below the (≤3) pinned ones, so a new
// round resets `knownOnlyRounds` before `patience`. After `patience` consecutive rounds with
// no new codes, everything below is already harvested (or there was nothing new today) — stop,
// but only after a known target-profile post has actually been observed.
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
    throw new Error("Instagram scrape observed zero target-profile posts; refusing empty success");
  }
  if (args.forward && !args.observedKnown) {
    throw new Error(
      "Instagram forward scrape never reached a known target-profile post; coverage is unproven",
    );
  }
}
