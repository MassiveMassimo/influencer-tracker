import { test, expect } from "bun:test";
import { dedupeFirstCall, buildScorecard } from "./scorecard";
import type { Call } from "./types";

function call(over: Partial<Call>): Call {
  return {
    shortcode: "x", postDate: "2026-01-01", ticker: "AAA", company: "A",
    isFirstCall: false, conviction: 0.8, quote: "buy",
    returns: { "1w": n(), "1m": n(), "3m": n(), "toDate": n() }, ...over,
  };
  function n() { return { stock: null, spy: null, excess: null }; }
}

test("dedupeFirstCall flags earliest postDate per ticker", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-03-01" }),
    call({ ticker: "AAA", postDate: "2026-01-01" }),
    call({ ticker: "BBB", postDate: "2026-02-01" }),
  ];
  const first = dedupeFirstCall(calls).filter(c => c.isFirstCall);
  expect(first.map(c => `${c.ticker}:${c.postDate}`).sort())
    .toEqual(["AAA:2026-01-01", "BBB:2026-02-01"]);
});

test("buildScorecard averages excess over elapsed horizons only", () => {
  const calls = [
    call({ ticker: "AAA", postDate: "2026-01-01",
      returns: { "1w": e(0.1), "1m": e(0.2), "3m": e(0.3), "toDate": e(0.3) } }),
    call({ ticker: "BBB", postDate: "2026-01-08",
      returns: { "1w": e(-0.1), "1m": e(null), "3m": e(null), "toDate": e(-0.1) } }),
  ];
  const sc = buildScorecard(dedupeFirstCall(calls));
  expect(sc.totalCalls).toBe(2);
  expect(sc.uniqueTickers).toBe(2);
  expect(sc.avgExcess["1w"]).toBeCloseTo(0.0, 6);
  expect(sc.avgExcess["1m"]).toBeCloseTo(0.2, 6);
  expect(sc.hitRate["1m"]).toBeCloseTo(1.0, 6);
  expect(sc.best[0].ticker).toBe("AAA");
  expect(sc.worst[0].ticker).toBe("BBB");
  function e(x: number | null) { return { stock: x, spy: 0, excess: x }; }
});
