export type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "All";

const TF_DAYS: Record<Exclude<Timeframe, "All">, number> = {
  "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365,
};

// Keep bars within `tf` calendar days of the LAST bar's date. "All" returns input.
export function windowSeries<T extends { date: string }>(bars: T[], tf: Timeframe): T[] {
  if (tf === "All" || bars.length === 0) return bars;
  const last = bars[bars.length - 1].date;
  const cutoff = new Date(last + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - TF_DAYS[tf]);
  const c = cutoff.toISOString().slice(0, 10);
  return bars.filter((b) => b.date >= c);
}

// How many viewport-widths the full series occupies at the given zoom level.
// `tf` days of history fill one viewport; the rest is reachable by scrolling.
// "All" (or too little data) fits in a single viewport → 1.
export function zoomMultiplier(bars: { date: string }[], tf: Timeframe): number {
  if (tf === "All" || bars.length < 2) return 1;
  const first = new Date(bars[0].date + "T00:00:00Z").getTime();
  const last = new Date(bars[bars.length - 1].date + "T00:00:00Z").getTime();
  const totalDays = (last - first) / 86400000;
  return Math.max(1, totalDays / TF_DAYS[tf]);
}
