import type { Call, Horizon, Scorecard, FunnelStage } from "./types";

const HORIZONS: Horizon[] = ["1w", "1m", "3m", "toDate"];

export const LOW_CONFIDENCE_N = 10;

export function buildFunnel(
  counts: { reelsScraped: number; reelsWithTicker: number },
  buyCalls: number,
  firstCalls: number,
  beatSpy: number,
  postNoun = "Reels", // platform's post word: "Reels" (IG), "Tweets" (X), "TikToks"
): FunnelStage[] {
  return [
    { label: `${postNoun} (12mo)`, value: counts.reelsScraped },
    { label: "Named a stock", value: counts.reelsWithTicker },
    { label: "Bullish buy call", value: buyCalls },
    { label: "First call (unique ticker)", value: firstCalls },
    { label: "Beat SPY (to date)", value: beatSpy },
  ];
}

export function dedupeFirstCall(calls: Call[]): Call[] {
  // Winning index per ticker: earliest postDate; ties (same day) broken by source
  // order (first occurrence wins, since we replace only on a strictly-earlier date).
  const winner = new Map<string, number>();
  calls.forEach((c, i) => {
    const prev = winner.get(c.ticker);
    if (prev === undefined || c.postDate < calls[prev]!.postDate) winner.set(c.ticker, i);
  });
  return calls.map((c, i) => ({ ...c, isFirstCall: winner.get(c.ticker) === i }));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function buildScorecard(calls: Call[]): Scorecard {
  const first = calls.filter(c => c.isFirstCall);
  const avgExcess = {} as Record<Horizon, number>;
  for (const h of HORIZONS) {
    avgExcess[h] = mean(first.map(c => c.returns[h].excess).filter((x): x is number => x != null));
  }
  const hit = (h: "1m" | "3m") => {
    const elapsed = first.map(c => c.returns[h].excess).filter((x): x is number => x != null);
    return elapsed.length ? elapsed.filter(x => x > 0).length / elapsed.length : 0;
  };
  const hitN = (h: "1m" | "3m") =>
    first.map(c => c.returns[h].excess).filter((x): x is number => x != null).length;
  const ranked = [...first]
    .filter(c => c.returns.toDate.excess != null)
    .sort((a, b) => (b.returns.toDate.excess! - a.returns.toDate.excess!));
  const spanDays = first.length
    ? (new Date(maxDate(first)).getTime() - new Date(minDate(first)).getTime()) / 86400000
    : 0;
  const weeks = Math.max(spanDays / 7, 1);
  return {
    totalCalls: calls.length,
    uniqueTickers: new Set(calls.map(c => c.ticker)).size,
    hitRate: { "1m": hit("1m"), "3m": hit("3m") },
    hitRateN: { "1m": hitN("1m"), "3m": hitN("3m") },
    avgExcess,
    callsPerWeek: first.length / weeks,
    best: ranked.slice(0, Math.floor(ranked.length / 2)).slice(0, 5),
    worst: ranked.slice(Math.ceil(ranked.length / 2)).reverse().slice(0, 5),
  };
}

function minDate(cs: Call[]): string { return cs.reduce((m, c) => c.postDate < m ? c.postDate : m, cs[0].postDate); }
function maxDate(cs: Call[]): string { return cs.reduce((m, c) => c.postDate > m ? c.postDate : m, cs[0].postDate); }
