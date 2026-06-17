import { test, expect } from "bun:test";
import { buildChartView } from "./chart-view.ts";

const baked = [
  { date: "2025-06-12", o: 1, h: 1, l: 1, c: 100 },
  { date: "2025-06-13", o: 1, h: 1, l: 1, c: 110 },
  { date: "2025-06-14", o: 1, h: 1, l: 1, c: 120 },
  { date: "2025-06-15", o: 1, h: 1, l: 1, c: 130 },
];

test("live data passes through unwindowed, no fallback", () => {
  const live = {
    ohlc: [{ date: "2025-06-15T13:30:00Z", o: 1, h: 1, l: 1, c: 130 }],
    spy: [{ date: "2025-06-15T13:30:00Z", o: 1, h: 1, l: 1, c: 500 }],
  };
  const v = buildChartView({ timeframe: "1D", live, bakedOhlc: baked, bakedSpy: baked });
  expect(v.usingFallback).toBe(false);
  expect(v.ohlc).toBe(live.ohlc);
});

test("fallback windows the baked series to the selected timeframe", () => {
  // 1D should keep only bars within 1 calendar day of the last bar (06-14, 06-15),
  // not the full baked history.
  const v = buildChartView({ timeframe: "1D", live: null, bakedOhlc: baked, bakedSpy: baked });
  expect(v.usingFallback).toBe(true);
  expect(v.ohlc.map((b) => b.date)).toEqual(["2025-06-14", "2025-06-15"]);
});

test("fallback with All returns the full baked series", () => {
  const v = buildChartView({ timeframe: "All", live: null, bakedOhlc: baked, bakedSpy: baked });
  expect(v.usingFallback).toBe(true);
  expect(v.ohlc).toHaveLength(4);
});
