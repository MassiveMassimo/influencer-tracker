import type { OhlcBar } from "./types";

// Union two daily-OHLC series by date (incoming wins on collision), sorted ascending.
// Used to dedupe per-ticker prices into one shared store across creators.
export function mergePrices(existing: OhlcBar[], incoming: OhlcBar[]): OhlcBar[] {
  const byDate = new Map<string, OhlcBar>();
  for (const b of existing) byDate.set(b.date, b);
  for (const b of incoming) byDate.set(b.date, b);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
