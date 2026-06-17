import type { Timeframe } from "./window-series.ts";

// Subset of yahoo-finance2 chart intervals this app uses.
export type LiveInterval = "5m" | "30m" | "1h" | "1d" | "1wk";

export interface ChartWindow {
  interval: LiveInterval;
  period1: Date;
}

const DAY_MS = 86_400_000;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

// Maps a timeframe to a Yahoo interval + start date. Intraday intervals are
// restricted to windows within Yahoo's ~60-day sub-daily cap (1D/1W/1M); 3M+
// use daily, matching the retail-app standard (Robinhood/Google Finance).
export function chartWindow(
  tf: Timeframe,
  opts: { now: Date; firstDate: Date },
): ChartWindow {
  const { now, firstDate } = opts;
  switch (tf) {
    case "1D":
      // Span several days back so the window always contains a full session even
      // before the US open (when "today" has no intraday bars yet) or over a
      // weekend/holiday. fetchChart trims this to the most recent session via
      // trimToLastSession, giving true single-session 1D semantics.
      return { interval: "5m", period1: daysAgo(now, 5) };
    case "1W":
      return { interval: "30m", period1: daysAgo(now, 7) };
    case "1M":
      return { interval: "1h", period1: daysAgo(now, 30) };
    case "3M":
      return { interval: "1d", period1: daysAgo(now, 90) };
    case "6M":
      return { interval: "1d", period1: daysAgo(now, 180) };
    case "1Y":
      return { interval: "1d", period1: daysAgo(now, 365) };
    case "All": {
      const overTwoYears = now.getTime() - firstDate.getTime() > 2 * 365 * DAY_MS;
      return { interval: overTwoYears ? "1wk" : "1d", period1: firstDate };
    }
  }
}
