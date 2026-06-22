import type { CallIndexEntry } from "./call-index";

export interface RailStock {
  symbol: string;
  company: string;
  lastCall: string;
}

// Tickers ordered by most-recent call, for the rail's Stocks list. Company is
// taken from the latest entry (names can drift); ties broken by symbol asc.
export function topStocksByLastCall(index: CallIndexEntry[], max = 20): RailStock[] {
  const byTicker = new Map<string, { lastCall: string; company: string }>();
  for (const r of index) {
    const symbol = r.ticker.toUpperCase();
    const prev = byTicker.get(symbol);
    if (!prev || r.postDate > prev.lastCall) {
      byTicker.set(symbol, { lastCall: r.postDate, company: r.company });
    }
  }
  return [...byTicker.entries()]
    .map(([symbol, v]) => ({ symbol, company: v.company, lastCall: v.lastCall }))
    .sort((a, b) => b.lastCall.localeCompare(a.lastCall) || a.symbol.localeCompare(b.symbol))
    .slice(0, max);
}
