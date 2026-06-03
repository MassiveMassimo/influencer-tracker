import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import YahooFinance from "yahoo-finance2";
import { chartWindow } from "./chart-window.ts";
import type { Timeframe } from "./window-series.ts";

// yahoo-finance2 ChartOptions["interval"] uses "60m" as the canonical alias for
// "1h". Both are accepted at runtime; this type covers only the values we use.
type YfInterval = "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d" | "5d" | "1wk" | "1mo" | "3mo";

// A live OHLC bar. Unlike the dataset's date-only OhlcBar, `date` is a full ISO
// datetime so intraday bars are distinct. Kept separate so DatasetSchema is
// untouched.
export interface LiveBar { date: string; o: number; h: number; l: number; c: number }

export interface ChartData {
  ohlc: LiveBar[];
  spy: LiveBar[];
  interval: string;
  asOf: string;
}

// Shape of a yahoo-finance2 chart quote (only the fields we read).
export interface RawQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export function toLiveBars(quotes: RawQuote[]): LiveBar[] {
  return quotes
    .filter((q) => q.open != null && q.close != null && q.high != null && q.low != null)
    .map((q) => ({
      date: new Date(q.date).toISOString(),
      o: q.open!,
      h: q.high!,
      l: q.low!,
      c: q.close!,
    }));
}

// --- In-memory TTL cache (per server instance) -----------------------------
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; bars: LiveBar[] }>();

export function cacheGet(key: string, now: number): LiveBar[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.bars;
}

export function cacheSet(key: string, bars: LiveBar[], now: number): void {
  cache.set(key, { at: now, bars });
}

// --- Yahoo fetch ------------------------------------------------------------
const yahoo = new YahooFinance();

// `key` is keyed by timeframe (not interval): 3M/6M/1Y all share interval "1d",
// so keying by interval would collide and return a too-short window. `period1`
// can't be in the key — it's derived from `new Date()` and shifts every call.
async function fetchSymbol(
  key: string,
  symbol: string,
  interval: ReturnType<typeof chartWindow>["interval"],
  period1: Date,
): Promise<LiveBar[]> {
  const now = Date.now();
  const cached = cacheGet(key, now);
  if (cached) return cached;
  // Cast needed: LiveInterval includes "1h" but yahoo-finance2's typed interval
  // enum uses "60m" as the canonical alias. Yahoo accepts "1h" at runtime; this
  // cast avoids a TS mismatch without changing behavior.
  const res = await yahoo.chart(symbol, {
    period1,
    interval: interval as YfInterval,
  });
  const bars = toLiveBars(res.quotes as RawQuote[]);
  // Cache empty results too: an empty window (market closed / thin symbol) is a
  // valid response, and the route has a baked fallback. Not caching it would let
  // every concurrent SSR render re-hit Yahoo's unofficial API for 5 minutes.
  cacheSet(key, bars, now);
  return bars;
}

const InputSchema = z.object({
  symbol: z.string().min(1).max(12),
  timeframe: z.enum(["1D", "1W", "1M", "3M", "6M", "1Y", "All"]),
  firstDate: z.string(), // ISO date of earliest call, used for the "All" window
});

export const fetchChart = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ChartData> => {
    const tf = data.timeframe as Timeframe;
    const { interval, period1 } = chartWindow(tf, {
      now: new Date(),
      firstDate: new Date(data.firstDate),
    });
    const [ohlc, spy] = await Promise.all([
      fetchSymbol(`${data.symbol}:${data.timeframe}`, data.symbol, interval, period1),
      fetchSymbol(`SPY:${data.timeframe}`, "SPY", interval, period1),
    ]);
    return { ohlc, spy, interval, asOf: new Date().toISOString() };
  });
