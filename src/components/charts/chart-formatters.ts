export const shortDateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export const weekdayDateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

// Crosshair pill label for intraday bars (sub-daily intervals): "09:30".
// Splits cleanly on ":" into hour/minute for the roll animation.
export const intradayTimeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const hmsTimeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
export const intFmt = new Intl.NumberFormat("en-US").format;

// True for a single intraday session (1D = 5-min bars), so axis/crosshair label
// by time of day instead of date. Keyed off median bar spacing, not calendar
// days: a 1D window trails ~24h and can cross midnight, so a same-day test
// mislabels it. Sub-15-min spacing isolates 1D from 1W (30m) / 1M (1h) / daily.
export function isIntradaySeries(times: number[]): boolean {
  if (times.length < 2) {
    return false;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median <= 15 * 60 * 1000;
}

// The axis/crosshair/tooltip label formatter: time of day for an intraday (1D)
// series, else the caller's date formatter (short vs weekday). One place for the
// choice that the chart shell, candlestick, x-axis, and tooltip all share.
export function intradayAwareFmt(
  times: number[],
  dateFmt: Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  return isIntradaySeries(times) ? intradayTimeFmt : dateFmt;
}
