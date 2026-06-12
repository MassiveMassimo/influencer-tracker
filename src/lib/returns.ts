import type { OhlcBar, Horizon, ReturnTriple } from "./types";

const HORIZON_DAYS: Record<Exclude<Horizon, "toDate">, number> = {
  "1w": 7, "1m": 30, "3m": 90,
};

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function closeOnOrAfter(ohlc: OhlcBar[], target: string): number | null {
  for (const bar of ohlc) {
    if (bar.date >= target) return bar.c;
  }
  return null;
}

function pctReturn(from: number, to: number): number {
  return to / from - 1;
}

// The first bar at or after `target`, or null if none. Used where the resolved
// date matters (coverage checks), unlike closeOnOrAfter which returns only the close.
function barOnOrAfter(ohlc: OhlcBar[], target: string): OhlcBar | null {
  for (const bar of ohlc) {
    if (bar.date >= target) return bar;
  }
  return null;
}

export function forwardReturn(ohlc: OhlcBar[], fromDate: string, calendarDays: number): number | null {
  const startBar = barOnOrAfter(ohlc, fromDate);
  if (startBar == null) return null;
  const endTarget = addDays(fromDate, calendarDays);
  const endBar = barOnOrAfter(ohlc, endTarget);
  if (endBar == null) return null;
  // Coverage guard: if the first available bar already sits at/after the horizon
  // end, the series begins after the window — there is no genuine "start" price,
  // so the horizon is unmeasurable (return null, not a fabricated 0%).
  if (startBar.date >= endTarget) return null;
  return pctReturn(startBar.c, endBar.c);
}

function toDateReturn(ohlc: OhlcBar[], fromDate: string): number | null {
  if (ohlc.length === 0) return null;
  const startBar = barOnOrAfter(ohlc, fromDate);
  if (startBar == null) return null;
  // If the first bar at/after the call date is more than a week later, the series
  // doesn't cover the call — measuring "to date" from it would use the wrong anchor.
  if (startBar.date > addDays(fromDate, 7)) return null;
  const last = ohlc[ohlc.length - 1].c;
  return pctReturn(startBar.c, last);
}

export function computeReturns(
  stock: OhlcBar[], spy: OhlcBar[], postDate: string,
): Record<Horizon, ReturnTriple> {
  const mk = (s: number | null, p: number | null): ReturnTriple => ({
    stock: s, spy: p, excess: s != null && p != null ? s - p : null,
  });
  return {
    "1w": mk(forwardReturn(stock, postDate, HORIZON_DAYS["1w"]), forwardReturn(spy, postDate, HORIZON_DAYS["1w"])),
    "1m": mk(forwardReturn(stock, postDate, HORIZON_DAYS["1m"]), forwardReturn(spy, postDate, HORIZON_DAYS["1m"])),
    "3m": mk(forwardReturn(stock, postDate, HORIZON_DAYS["3m"]), forwardReturn(spy, postDate, HORIZON_DAYS["3m"])),
    "toDate": mk(toDateReturn(stock, postDate), toDateReturn(spy, postDate)),
  };
}
