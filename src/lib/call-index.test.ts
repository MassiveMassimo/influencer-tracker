import { test, expect } from "bun:test";
import { buildCallsIndex, CallIndexSchema } from "./call-index";
import type { Dataset, Call } from "./types";

function call(over: Partial<Call> & { shortcode: string; ticker: string; postDate: string }): Call {
  return {
    company: "Acme",
    isFirstCall: true,
    conviction: 0.5,
    quote: "buy it",
    summary: "thesis",
    onScreenPrice: null,
    spark: [1, 2, 3],
    returns: {
      "1w": { stock: null, spy: null, excess: null },
      "1m": { stock: null, spy: null, excess: null },
      "3m": { stock: 0.1, spy: 0.04, excess: 0.06 },
      toDate: { stock: 0.2, spy: 0.05, excess: 0.15 },
    },
    ...over,
  };
}
function ds(handle: string, calls: Call[]): Dataset {
  return {
    creator: { handle, name: handle.toUpperCase() },
    generatedAt: "2026-06-01",
    spyAnchor: "SPY",
    calls,
    scorecard: {
      totalCalls: calls.length,
      uniqueTickers: 1,
      hitRate: { "1m": 0, "3m": 0 },
      hitRateN: { "1m": 0, "3m": 0 },
      avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
      callsPerWeek: 0,
      best: [],
      worst: [],
    },
    caveats: [],
  };
}

test("flattens every creator's calls into the slim shape, dropping heavy fields", () => {
  const out = buildCallsIndex([
    ds("alice", [call({ shortcode: "a1", ticker: "NVDA", postDate: "2026-05-01" })]),
    ds("bob", [call({ shortcode: "b1", ticker: "AMD", postDate: "2026-05-02" })]),
  ]);
  expect(out).toHaveLength(2);
  const e = out.find((r) => r.shortcode === "a1")!;
  expect(e.handle).toBe("alice");
  expect(e.ticker).toBe("NVDA");
  expect(e.ex3m).toBe(0.06);
  expect(e.exToDate).toBe(0.15);
  expect(e.stockToDate).toBe(0.2);
  expect(e).not.toHaveProperty("quote");
  expect(e).not.toHaveProperty("spark");
  expect(e).not.toHaveProperty("returns");
});

test("orders by postDate desc, then handle, then shortcode (deterministic)", () => {
  const out = buildCallsIndex([
    ds("bob", [call({ shortcode: "b1", ticker: "AMD", postDate: "2026-05-01" })]),
    ds("alice", [
      call({ shortcode: "a2", ticker: "NVDA", postDate: "2026-05-01" }),
      call({ shortcode: "a1", ticker: "NVDA", postDate: "2026-05-05" }),
    ]),
  ]);
  expect(out.map((r) => r.shortcode)).toEqual(["a1", "a2", "b1"]);
});

test("output validates against CallIndexSchema", () => {
  const out = buildCallsIndex([
    ds("alice", [call({ shortcode: "a1", ticker: "NVDA", postDate: "2026-05-01" })]),
  ]);
  expect(() => CallIndexSchema.parse(out)).not.toThrow();
});
