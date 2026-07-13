export type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "All";

const TF_DAYS: Record<Exclude<Timeframe, "All">, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
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

// US regular trading hours in New York wall-clock (09:30–16:00), DST-correct.
const NY_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});
// New-York calendar day key (YYYY-MM-DD) so sessions group by US date, not UTC
// (a US session never crosses ET midnight, but it does cross UTC midnight).
const NY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function nyMinutes(iso: string): number {
  const [h, m] = NY_HM.format(new Date(iso)).split(":");
  return Number(h) * 60 + Number(m);
}
function isRegularHours(iso: string): boolean {
  const t = nyMinutes(iso);
  return t >= 9 * 60 + 30 && t < 16 * 60; // 09:30 <= t < 16:00 ET
}

// Narrow live intraday bars to a single regular trading session (1D semantics —
// one session, like Robinhood/Google). The fetch window is intentionally a few
// days wide so it always contains a session even pre-open or over a weekend;
// this drops pre/after-market bars and keeps the latest ET day that has a
// regular session — so before the US open, 1D shows yesterday's full session
// rather than a handful of thin pre-market prints. SPY is aligned to the same
// session day so the rebased vs-SPY line shares the window. Falls back to the
// last UTC day if no regular-hours bars exist (rare data gap), never empty.
export function trimToLastSession<S extends { date: string }, P extends { date: string }>(
  ohlc: S[],
  spy: P[],
): { ohlc: S[]; spy: P[] } {
  if (ohlc.length === 0) return { ohlc, spy };
  const regular = ohlc.filter((b) => isRegularHours(b.date));
  if (regular.length === 0) {
    const day = ohlc[ohlc.length - 1].date.slice(0, 10);
    return {
      ohlc: ohlc.filter((b) => b.date.slice(0, 10) === day),
      spy: spy.filter((b) => b.date.slice(0, 10) === day),
    };
  }
  const day = NY_DAY.format(new Date(regular[regular.length - 1].date));
  const inSession = (b: { date: string }) =>
    isRegularHours(b.date) && NY_DAY.format(new Date(b.date)) === day;
  return { ohlc: ohlc.filter(inSession), spy: spy.filter(inSession) };
}
