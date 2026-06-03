export type Timeframe = "1M" | "3M" | "6M" | "1Y" | "All";

const TF_DAYS: Record<Exclude<Timeframe, "All">, number> = {
  "1M": 30, "3M": 90, "6M": 180, "1Y": 365,
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
