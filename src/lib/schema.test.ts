import { test, expect } from "bun:test";
import { DatasetSchema } from "./schema";

const valid = {
  creator: { handle: "kevvonz", name: "Kevin Hu" },
  generatedAt: "2026-06-02",
  spyAnchor: "SPY",
  calls: [{
    shortcode: "DZDmQutB0Ep", postDate: "2026-06-01", ticker: "NBIS",
    company: "Nebius Group N.V.", isFirstCall: true, conviction: 0.9,
    quote: "buy right here", onScreenPrice: 273.01,
    returns: { "1w": { stock: null, spy: null, excess: null },
               "1m": { stock: null, spy: null, excess: null },
               "3m": { stock: null, spy: null, excess: null },
               "toDate": { stock: 0.1, spy: 0.05, excess: 0.05 } },
  }],
  tickers: { NBIS: { ohlc: [{ date: "2026-06-01", o: 1, h: 2, l: 1, c: 2 }] } },
  scorecard: { totalCalls: 1, uniqueTickers: 1, hitRate: { "1m": 0, "3m": 0 },
    hitRateN: { "1m": 0, "3m": 0 },
    avgExcess: { "1w": 0, "1m": 0, "3m": 0, "toDate": 0.05 },
    callsPerWeek: 0.5, best: [], worst: [] },
  caveats: ["survivorship"],
};

test("accepts a valid dataset", () => {
  expect(() => DatasetSchema.parse(valid)).not.toThrow();
});

test("rejects a call missing ticker", () => {
  const bad = structuredClone(valid);
  // @ts-expect-error intentional
  delete bad.calls[0].ticker;
  expect(() => DatasetSchema.parse(bad)).toThrow();
});
