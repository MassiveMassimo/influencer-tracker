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
