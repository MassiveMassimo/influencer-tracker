import type { OhlcBar, Call, CumPoint } from "./types";

// Grace window matching toDateReturn: skip a call whose price series doesn't begin
// within a week of its post date (no genuine entry anchor → unmeasurable).
const ENTRY_GRACE_DAYS = 7;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function barOnOrAfter(bars: OhlcBar[], target: string): OhlcBar | null {
  for (const b of bars) if (b.date >= target) return b;
  return null;
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

// Even-sample to at most maxPoints, always keeping the first and last point.
function downsample(xs: CumPoint[], maxPoints: number): CumPoint[] {
  if (xs.length <= maxPoints || maxPoints <= 1) return xs;
  const step = (xs.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => xs[Math.round(i * step)]!);
}

/**
 * Daily equal-weight mean excess-return-vs-SPY curve across the creator's scored
 * first-calls — the to-date excess metric generalized to a time series.
 *
 * Each call enters at the first stock bar on/after its postDate (with the matching
 * SPY bar), using the same coverage guard as the to-date scoring. At each SPY
 * trading day `t` on/after the earliest entry, a call active by `t` contributes
 *   (stockClose≤t / stockEntry − 1) − (spyClose_t / spyEntry − 1)
 * and the curve value is the mean over active calls. v = 0 means "matched SPY on
 * average"; the endpoint equals scorecard.avgExcess.toDate (same set + entry
 * semantics). Downsampled to keep dataset.json slim.
 */
export function buildCumExcess(
  calls: Call[],
  ohlc: Record<string, OhlcBar[]>,
  spy: OhlcBar[],
  maxPoints = 90,
): CumPoint[] {
  if (spy.length === 0) return [];

  type Entry = { bars: OhlcBar[]; stockEntry: number; spyEntry: number; entryDate: string };
  const entries: Entry[] = [];
  for (const c of calls) {
    if (!c.isFirstCall) continue;
    const bars = ohlc[c.ticker] ?? [];
    const sb = barOnOrAfter(bars, c.postDate);
    const pb = barOnOrAfter(spy, c.postDate);
    if (!sb || !pb) continue;
    if (sb.date > addDays(c.postDate, ENTRY_GRACE_DAYS)) continue;
    if (pb.date > addDays(c.postDate, ENTRY_GRACE_DAYS)) continue;
    entries.push({ bars, stockEntry: sb.c, spyEntry: pb.c, entryDate: sb.date });
  }
  if (entries.length === 0) return [];

  const earliest = entries.reduce(
    (m, e) => (e.entryDate < m ? e.entryDate : m),
    entries[0]!.entryDate,
  );
  const grid = spy.filter((b) => b.date >= earliest);
  const ptr = entries.map(() => 0); // index of last stock bar with date <= current grid date

  const series: CumPoint[] = [];
  for (const g of grid) {
    const t = g.date;
    const spyClose = g.c;
    let sum = 0;
    let n = 0;
    for (let e = 0; e < entries.length; e++) {
      const en = entries[e]!;
      if (t < en.entryDate) continue; // not active yet
      const bars = en.bars;
      let i = ptr[e]!;
      while (i + 1 < bars.length && bars[i + 1]!.date <= t) i++;
      ptr[e] = i;
      const stockClose = bars[i]!.c;
      sum += stockClose / en.stockEntry - 1 - (spyClose / en.spyEntry - 1);
      n++;
    }
    if (n > 0) series.push({ t, v: round4(sum / n) });
  }
  return downsample(series, maxPoints);
}
