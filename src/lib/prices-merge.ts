import type { OhlcBar } from "./types";

// Detect a stock-split/dividend basis shift between an existing frozen series and a
// freshly-fetched one: a consistent non-1 close ratio across the overlapping dates means
// Yahoo restated the whole history at a new basis. Returns the shift factor (incoming/existing)
// when the overlap is >=2 dates AND every overlapping ratio is within 2% of their average AND
// that average is >1% off 1.0; otherwise null (same basis, too little overlap, or noisy).
export function detectBasisShift(existing: OhlcBar[], incoming: OhlcBar[]): number | null {
  const inc = new Map(incoming.map((b) => [b.date, b.c]));
  const ratios: number[] = [];
  for (const b of existing) {
    const c = inc.get(b.date);
    if (c != null && b.c !== 0) ratios.push(c / b.c);
  }
  if (ratios.length < 2) return null;
  const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  if (Math.abs(avg - 1) < 0.01) return null;                  // same basis
  if (ratios.every((r) => Math.abs(r - avg) <= 0.02 * avg)) return avg; // consistent shift
  return null;                                                // noisy → not a clean split
}

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
