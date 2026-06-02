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

export function forwardReturn(ohlc: OhlcBar[], fromDate: string, calendarDays: number): number | null {
  const start = closeOnOrAfter(ohlc, fromDate);
  if (start == null) return null;
  const end = closeOnOrAfter(ohlc, addDays(fromDate, calendarDays));
  if (end == null) return null;
  return pctReturn(start, end);
}

function toDateReturn(ohlc: OhlcBar[], fromDate: string): number | null {
  const start = closeOnOrAfter(ohlc, fromDate);
  if (start == null || ohlc.length === 0) return null;
  const last = ohlc[ohlc.length - 1].c;
  return pctReturn(start, last);
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
