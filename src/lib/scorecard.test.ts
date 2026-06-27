import { test, expect } from "bun:test";
import { dedupeFirstCall, buildScorecard, buildFunnel, LOW_CONFIDENCE_N } from "./scorecard";
import type { Call } from "./types";

function call(over: Partial<Call>): Call {
  return {
    shortcode: "x",
    postDate: "2026-01-01",
    ticker: "AAA",
    company: "A",
    isFirstCall: false,
    conviction: 0.8,
    quote: "buy",
    returns: { "1w": n(), "1m": n(), "3m": n(), toDate: n() },
    ...over,
  };
  function n() {
    return { stock: null, spy: null, excess: null };
  }
}

test("dedupeFirstCall flags earliest postDate per ticker", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-03-01" }),
    call({ ticker: "AAA", postDate: "2026-01-01" }),
    call({ ticker: "BBB", postDate: "2026-02-01" }),
  ];
  const first = dedupeFirstCall(calls).filter((c) => c.isFirstCall);
  expect(first.map((c) => `${c.ticker}:${c.postDate}`).sort()).toEqual([
    "AAA:2026-01-01",
    "BBB:2026-02-01",
  ]);
});

test("dedupeFirstCall picks exactly one first-call when two share the earliest day", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-01-01", shortcode: "first" }),
    call({ ticker: "AAA", postDate: "2026-01-01", shortcode: "second" }),
    call({ ticker: "AAA", postDate: "2026-02-01", shortcode: "later" }),
  ];
  const flagged = dedupeFirstCall(calls).filter((c) => c.isFirstCall);
  expect(flagged.length).toBe(1);
  expect(flagged[0]!.shortcode).toBe("first"); // earliest day, first in source order
});

test("buildScorecard averages excess over elapsed horizons only", () => {
  const calls = [
    call({
      ticker: "AAA",
      postDate: "2026-01-01",
      returns: { "1w": e(0.1), "1m": e(0.2), "3m": e(0.3), toDate: e(0.3) },
    }),
    call({
      ticker: "BBB",
      postDate: "2026-01-08",
      returns: { "1w": e(-0.1), "1m": e(null), "3m": e(null), toDate: e(-0.1) },
    }),
  ];
  const sc = buildScorecard(dedupeFirstCall(calls));
  expect(sc.totalCalls).toBe(2);
  expect(sc.uniqueTickers).toBe(2);
  expect(sc.avgExcess["1w"]).toBeCloseTo(0.0, 6);
  expect(sc.avgExcess["1m"]).toBeCloseTo(0.2, 6);
  expect(sc.hitRate["1m"]).toBeCloseTo(1.0, 6);
  expect(sc.best[0].ticker).toBe("AAA");
  expect(sc.worst[0].ticker).toBe("BBB");
  function e(x: number | null) {
    return { stock: x, spy: 0, excess: x };
  }
});

test("hitRateN counts first-calls with elapsed excess per horizon", () => {
  const e = (x: number | null) => ({ stock: x, spy: 0, excess: x });
  const calls = [
    call({
      ticker: "AAA",
      postDate: "2025-01-01",
      returns: { "1w": e(0.1), "1m": e(0.1), "3m": e(0.1), toDate: e(0.1) },
    }),
    call({
      ticker: "BBB",
      postDate: "2025-01-02",
      returns: { "1w": e(0), "1m": e(0), "3m": e(-0.2), toDate: e(-0.2) },
    }),
    call({
      ticker: "CCC",
      postDate: "2025-01-03",
      returns: { "1w": e(0.3), "1m": e(0.3), "3m": e(null), toDate: e(0.3) },
    }),
  ];
  const sc = buildScorecard(dedupeFirstCall(calls));
  expect(sc.hitRateN["3m"]).toBe(2); // AAA, BBB have 3m; CCC pending
  expect(sc.hitRateN["1m"]).toBe(3);
  expect(sc.hitRate["3m"]).toBeCloseTo(0.5); // AAA up, BBB down => 1/2
});

test("hitRateN is 0 when all calls pending", () => {
  const sc = buildScorecard(dedupeFirstCall([call({ ticker: "AAA", postDate: "2025-01-01" })]));
  expect(sc.hitRateN["3m"]).toBe(0);
  expect(sc.hitRate["3m"]).toBe(0);
});

test("buildFunnel produces 5 monotonically-narrowing stages", () => {
  const f = buildFunnel({ reelsScraped: 157, reelsWithTicker: 27 }, 13, 10, 4);
  expect(f.map((s) => s.value)).toEqual([157, 27, 13, 10, 4]);
  expect(f.map((s) => s.label)).toEqual([
    "Reels (12mo)",
    "Named a stock",
    "Bullish buy call",
    "First call (unique ticker)",
    "Beat SPY (to date)",
  ]);
});

test("LOW_CONFIDENCE_N is 10", () => {
  expect(LOW_CONFIDENCE_N).toBe(10);
});
