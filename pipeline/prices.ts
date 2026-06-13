import YahooFinance from "yahoo-finance2";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir } from "./config";
import { mergePrices, detectBasisShift } from "../src/lib/prices-merge";
import type { OhlcBar, ReelCall } from "../src/lib/types";

const yahooFinance = new YahooFinance();

// Drop the current UTC day (and anything later): Yahoo's daily chart includes today's
// in-progress candle during market hours, and the insert-only merge would freeze that
// partial bar forever, dropping the settled close. A bar matures one day later — harmless
// at the 1w/1m/3m/to-date horizons we score.
export function dropUnsettled(bars: OhlcBar[], todayUtc: string): OhlcBar[] {
  return bars.filter((b) => b.date < todayUtc);
}

async function fetchOhlc(symbol: string, from: string): Promise<OhlcBar[]> {
  const rows = await yahooFinance.chart(symbol, { period1: from, interval: "1d" });
  const todayUtc = new Date().toISOString().slice(0, 10);
  const mapped = rows.quotes
    .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
    .map(q => ({ date: new Date(q.date).toISOString().slice(0, 10),
      o: q.open!, h: q.high!, l: q.low!, c: q.close! }));
  return dropUnsettled(mapped, todayUtc);
}

// Exported for tests. A cached series covers the needed range if it has more than
// one bar and its earliest bar is at/before the requested `from` date.
export function cacheCovers(cached: unknown, from: string): boolean {
  if (!Array.isArray(cached) || cached.length <= 1) return false;
  const first = cached[0];
  return typeof first?.date === "string" && first.date <= from;
}

export async function prices(handle: string) {
  await mkdir(pricesDir(handle), { recursive: true });
  const calls: ReelCall[] = JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"));
  const tickers = [...new Set(calls.map(c => c.ticker)), "SPY"];
  const from = calls.reduce((m, c) => c.postDate < m ? c.postDate : m, calls[0]?.postDate ?? "2025-01-01");
  for (const t of tickers) {
    const out = join(pricesDir(handle), `${t}.json`);
    let cachedBars: OhlcBar[] = [];
    if (existsSync(out)) {
      // Distrust truncated/under-covered caches: a partial Yahoo run can leave a
      // short file the old existsSync skip would keep forever (SPY benchmark broke
      // this way), and a newly-discovered older call can lower `from` below the
      // cache's earliest bar. cacheCovers requires >1 bar AND earliest bar <= from.
      try {
        const cached = JSON.parse(await readFile(out, "utf8"));
        cachedBars = Array.isArray(cached) ? cached : [];
        if (cacheCovers(cached, from)) {
          // Front-covered: extend FORWARD instead of skipping, else to-date freezes and
          // recent horizons never mature. Fetch from ~10 days before the last bar so the
          // overlap is >=2 trading days — detectBasisShift needs >=2 overlapping bars to fire.
          const lastDate = cachedBars[cachedBars.length - 1]?.date ?? from;
          const overlapFrom = new Date(new Date(lastDate).getTime() - 10 * 86400_000).toISOString().slice(0, 10);
          try {
            const fwd = await fetchOhlc(t, overlapFrom);
            const shift = detectBasisShift(cachedBars, fwd);
            if (shift != null) { console.warn(`SPLIT ${t}: basis shift x${shift.toFixed(4)} — skipping append, needs OWNER restatement`); continue; }
            const ohlc = mergePrices(cachedBars, fwd);
            await writeFile(out, JSON.stringify(ohlc));
            console.log(`prices ${t}: extended to ${ohlc[ohlc.length - 1]?.date} (${ohlc.length} bars)`);
          } catch (e) { console.warn(`FLAG ${t}: forward-extend failed: ${(e as Error).message}`); }
          continue;
        }
        console.warn(`REFETCH ${t}: cache misses coverage (need <= ${from}, have ${Array.isArray(cached) && cached[0]?.date ? cached[0].date : "?"} / ${Array.isArray(cached) ? cached.length : 0} bar(s))`);
      } catch {
        console.warn(`REFETCH ${t}: unreadable cache`);
      }
    }
    try {
      const fetched = await fetchOhlc(t, from);
      if (!fetched.length) { console.warn(`FLAG ${t}: no price data`); continue; }
      const shift = detectBasisShift(cachedBars, fetched);
      if (shift != null) { console.warn(`SPLIT ${t}: basis shift x${shift.toFixed(4)} — skipping merge, needs OWNER restatement`); continue; }
      // Existing-wins merge: never rewrite a frozen scored bar; append only new dates.
      const ohlc = mergePrices(cachedBars, fetched);
      await writeFile(out, JSON.stringify(ohlc));
      console.log(`prices ${t}: ${ohlc.length} bars`);
    } catch (e) { console.warn(`FLAG ${t}: ${(e as Error).message}`); }
  }
}
