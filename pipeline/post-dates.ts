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
