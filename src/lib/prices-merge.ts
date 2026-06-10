import type { OhlcBar } from "./types";

// Union two daily-OHLC series by date, sorted ascending. Insert-only: an existing
// date keeps its OHLC; only genuinely-new dates from `incoming` are appended. This
// mirrors the DB `prices` table (insert-only via onConflictDoNothing) so the shared
// static store and the frozen DB never drift — a Yahoo restatement can't silently
// rewrite an already-scored bar. See the restatement runbook in CLAUDE.md.
// Used to dedupe per-ticker prices into one shared store across creators.
export function mergePrices(existing: OhlcBar[], incoming: OhlcBar[]): OhlcBar[] {
  const byDate = new Map<string, OhlcBar>();
  // second write wins in a Map; incoming is written first so existing survives the collision (insert-only, matches DB onConflictDoNothing).
  for (const b of incoming) byDate.set(b.date, b);
  for (const b of existing) byDate.set(b.date, b); // existing wins on collision
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
