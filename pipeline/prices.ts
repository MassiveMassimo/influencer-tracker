import YahooFinance from "yahoo-finance2";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir } from "./config";
import type { OhlcBar, ReelCall } from "../src/lib/types";

const yahooFinance = new YahooFinance();

async function fetchOhlc(symbol: string, from: string): Promise<OhlcBar[]> {
  const rows = await yahooFinance.chart(symbol, { period1: from, interval: "1d" });
  return rows.quotes
    .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
    .map(q => ({ date: new Date(q.date).toISOString().slice(0,10),
      o: q.open!, h: q.high!, l: q.low!, c: q.close! }));
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
    if (existsSync(out)) {
      // Distrust truncated/under-covered caches: a partial Yahoo run can leave a
      // short file the old existsSync skip would keep forever (SPY benchmark broke
      // this way), and a newly-discovered older call can lower `from` below the
      // cache's earliest bar. cacheCovers requires >1 bar AND earliest bar <= from.
      try {
        const cached = JSON.parse(await readFile(out, "utf8"));
        if (cacheCovers(cached, from)) continue;
        console.warn(`REFETCH ${t}: cache misses coverage (need <= ${from}, have ${Array.isArray(cached) && cached[0]?.date ? cached[0].date : "?"} / ${Array.isArray(cached) ? cached.length : 0} bar(s))`);
      } catch {
        console.warn(`REFETCH ${t}: unreadable cache`);
      }
    }
    try {
      const ohlc = await fetchOhlc(t, from);
      if (!ohlc.length) { console.warn(`FLAG ${t}: no price data`); continue; }
      await writeFile(out, JSON.stringify(ohlc));
      console.log(`prices ${t}: ${ohlc.length} bars`);
    } catch (e) { console.warn(`FLAG ${t}: ${(e as Error).message}`); }
  }
}
