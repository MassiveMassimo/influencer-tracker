import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir, DATA, ROOT } from "./config";
import { computeReturns } from "../src/lib/returns";
import { dedupeFirstCall, buildScorecard, buildFunnel } from "../src/lib/scorecard";
import { DatasetSchema } from "../src/lib/schema";
import { buildSpark } from "../src/lib/spark";
import { mergePrices, detectBasisShift } from "../src/lib/prices-merge";
import { resolveSymbol } from "../src/lib/symbol";
import { quoteTypes, isOutOfScope } from "./symbol-scope";
import type { Dataset, ReelCall, OhlcBar, Call } from "../src/lib/types";

const CAVEATS = ["survivorship", "reposts-deduped", "forward-from-post-date"];

export function assembleDataset(
  creator: { handle: string; name: string },
  reelCalls: ReelCall[],
  ohlc: Record<string, OhlcBar[]>,
  generatedAt: string,
  counts?: { reelsScraped: number; reelsWithTicker: number },
  postNoun = "Reels",
  // Scope gate: drop calls whose canonical symbol is an index ETF / fund / index /
  // derivative (not a stock pick). Injected so this stays a pure fn — score()
  // resolves it from Yahoo quoteType (symbol-scope.ts); default keeps all (tests).
  isInScope: (sym: string) => boolean = () => true,
): Dataset {
  const spy = ohlc["SPY"] ?? [];
  const bullish = reelCalls.filter(c => c.isExplicitBuy && c.direction === "bullish");
  // Priceability gate: a bullish call is scored only if its ticker resolves to a
  // canonical Yahoo symbol that has price bars. Unresolvable (null) or dataless
  // tickers are excluded and logged — never emitted as a scored call with an
  // empty price file. The emitted ticker is the canonical symbol, so fragmented
  // crypto calls (BTCUSD/BTCUSDT/BTC.X) merge onto one ticker page.
  let calls: Call[] = bullish.flatMap(c => {
    const sym = resolveSymbol(c.ticker);
    const bars = sym ? (ohlc[sym] ?? []) : [];
    if (!sym || bars.length === 0) {
      console.warn(`UNPRICEABLE ${c.ticker} (${sym ? "no price data" : "unresolved/out-of-scope"}) — shortcode ${c.shortcode}`);
      return [];
    }
    if (!isInScope(sym)) return []; // out-of-scope type; logged once per symbol in score()
    return [{
      shortcode: c.shortcode, postDate: c.postDate, ticker: sym, company: c.company,
      isFirstCall: false, conviction: c.conviction, quote: c.quote, summary: c.summary, onScreenPrice: c.onScreenPrice,
      spark: buildSpark(bars, c.postDate),
      returns: computeReturns(bars, spy, c.postDate),
    }];
  });
  calls = dedupeFirstCall(calls);
  const firstCalls = calls.filter(c => c.isFirstCall);
  const beatSpy = firstCalls.filter(c => (c.returns.toDate.excess ?? -1) > 0).length;
  const funnel = counts
    ? buildFunnel(counts, calls.length, firstCalls.length, beatSpy, postNoun)
    : undefined;
  const ds: Dataset = {
    creator, generatedAt, spyAnchor: "SPY", calls,
    scorecard: { ...buildScorecard(calls), funnel },
    caveats: calls.some(c => c.ticker.endsWith("-USD")) ? [...CAVEATS, "crypto-vs-spy"] : CAVEATS,
  };
  DatasetSchema.parse(ds); // fail-closed on a malformed dataset
  return ds;
}

export async function score(handle: string, name: string, today = new Date().toISOString().slice(0,10), postNoun = "Reels") {
  const reelCalls: ReelCall[] = JSON.parse(await readFile(join(creatorDir(handle), "reel-calls.json"), "utf8"));
  const ohlc: Record<string, OhlcBar[]> = {};
  for (const f of await readdir(pricesDir(handle))) {
    if (f.endsWith(".json")) ohlc[f.replace(".json","")] = JSON.parse(await readFile(join(pricesDir(handle), f), "utf8"));
  }
  let reelsScraped = reelCalls.length;
  try { reelsScraped = JSON.parse(await readFile(join(creatorDir(handle), "raw", "shortcodes.json"), "utf8")).length; } catch {}
  // Resolve scope (Yahoo quoteType, cached) for every priced symbol, then drop
  // out-of-scope ones from scoring. SPY is the benchmark, never a scored call.
  const symbols = Object.keys(ohlc).filter(s => s !== "SPY");
  const types = await quoteTypes(symbols);
  const outOfScope = new Set(symbols.filter(s => isOutOfScope(types[s])));
  for (const s of outOfScope) console.warn(`OUT-OF-SCOPE ${s}: ${types[s]} — not a stock pick, excluded from scoring`);
  const ds = assembleDataset({ handle, name }, reelCalls, ohlc, today,
    { reelsScraped, reelsWithTicker: reelCalls.length }, postNoun, sym => !outOfScope.has(sym));
  await writeFile(join(creatorDir(handle), "dataset.json"), JSON.stringify(ds, null, 2));
  // Write deduped per-ticker prices to a shared store (one file per symbol across
  // all creators) for the ticker-page fallback. Merge so a creator with a shorter
  // history never truncates another's bars.
  // `pricesDir(handle)` (read above) is the per-creator price input; this is the
  // shared cross-creator output store.
  const sharedDir = join(ROOT, "data", "prices");
  await mkdir(sharedDir, { recursive: true });
  for (const sym of new Set([...ds.calls.map(c => c.ticker), "SPY"])) {
    const bars = ohlc[sym] ?? [];
    if (!bars.length) continue;
    const f = join(sharedDir, `${sym}.json`);
    const existing: OhlcBar[] = existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : [];
    const shift = detectBasisShift(existing, bars);
    if (shift != null) { console.warn(`SPLIT ${sym}: basis shift x${shift.toFixed(4)} — skipping merge, needs OWNER restatement`); continue; }
    await writeFile(f, JSON.stringify(mergePrices(existing, bars)));
  }
  await updateIndex(handle, name, ds);
  return ds;
}

async function updateIndex(handle: string, name: string, ds: Dataset) {
  const path = join(DATA, "index.json");
  const idx: any[] = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : [];
  let avatar: string | undefined;
  try { avatar = (await readFile(join(creatorDir(handle), "avatar.txt"), "utf8")).trim(); } catch {}
  const entry = {
    handle, name,
    totalCalls: ds.scorecard.totalCalls,
    firstCalls: ds.scorecard.uniqueTickers,
    hitRate3m: ds.scorecard.hitRate["3m"],
    hitRate3mN: ds.scorecard.hitRateN["3m"],
    avgExcess3m: ds.scorecard.avgExcess["3m"],
    generatedAt: ds.generatedAt,
    ...(avatar ? { avatar } : {}),
  };
  const i = idx.findIndex(e => e.handle === handle);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  await mkdir(DATA, { recursive: true });
  await writeFile(path, JSON.stringify(idx, null, 2));
}
