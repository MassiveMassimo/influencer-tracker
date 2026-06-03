import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { creatorDir, pricesDir, DATA } from "./config";
import { computeReturns } from "../src/lib/returns";
import { dedupeFirstCall, buildScorecard, buildFunnel } from "../src/lib/scorecard";
import { DatasetSchema } from "../src/lib/schema";
import type { Dataset, ReelCall, OhlcBar, Call } from "../src/lib/types";

const CAVEATS = ["survivorship", "reposts-deduped", "forward-from-post-date"];

export function assembleDataset(
  creator: { handle: string; name: string },
  reelCalls: ReelCall[],
  ohlc: Record<string, OhlcBar[]>,
  generatedAt: string,
  counts?: { reelsScraped: number; reelsWithTicker: number },
  postNoun = "Reels",
): Dataset {
  const spy = ohlc["SPY"] ?? [];
  const bullish = reelCalls.filter(c => c.isExplicitBuy && c.direction === "bullish");
  let calls: Call[] = bullish.map(c => ({
    shortcode: c.shortcode, postDate: c.postDate, ticker: c.ticker, company: c.company,
    isFirstCall: false, conviction: c.conviction, quote: c.quote, summary: c.summary, onScreenPrice: c.onScreenPrice,
    returns: computeReturns(ohlc[c.ticker] ?? [], spy, c.postDate),
  }));
  calls = dedupeFirstCall(calls);
  const firstCalls = calls.filter(c => c.isFirstCall);
  const beatSpy = firstCalls.filter(c => (c.returns.toDate.excess ?? -1) > 0).length;
  const funnel = counts
    ? buildFunnel(counts, calls.length, firstCalls.length, beatSpy, postNoun)
    : undefined;
  const tickers: Record<string, { ohlc: OhlcBar[] }> = {};
  for (const t of [...new Set(calls.map(c => c.ticker)), "SPY"]) tickers[t] = { ohlc: ohlc[t] ?? [] };
  const ds: Dataset = {
    creator, generatedAt, spyAnchor: "SPY", calls, tickers,
    scorecard: { ...buildScorecard(calls), funnel }, caveats: CAVEATS,
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
  const ds = assembleDataset({ handle, name }, reelCalls, ohlc, today,
    { reelsScraped, reelsWithTicker: reelCalls.length }, postNoun);
  await writeFile(join(creatorDir(handle), "dataset.json"), JSON.stringify(ds, null, 2));
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
