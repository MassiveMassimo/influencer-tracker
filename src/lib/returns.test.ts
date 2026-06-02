import { test, expect } from "bun:test";
import { closeOnOrAfter, forwardReturn, computeReturns } from "./returns";
import type { OhlcBar } from "./types";

const bars: OhlcBar[] = [
  { date: "2026-06-01", o: 100, h: 100, l: 100, c: 100 },
  { date: "2026-06-02", o: 101, h: 101, l: 101, c: 101 },
  { date: "2026-06-03", o: 102, h: 102, l: 102, c: 102 },
  { date: "2026-06-04", o: 103, h: 103, l: 103, c: 103 },
  { date: "2026-06-05", o: 104, h: 104, l: 104, c: 104 },
  { date: "2026-06-08", o: 110, h: 110, l: 110, c: 110 },
];

test("closeOnOrAfter returns same-day close when present", () => {
  expect(closeOnOrAfter(bars, "2026-06-02")).toBe(101);
});
test("closeOnOrAfter rolls forward over a weekend gap", () => {
  expect(closeOnOrAfter(bars, "2026-06-06")).toBe(110);
});
test("closeOnOrAfter returns null past the last bar", () => {
  expect(closeOnOrAfter(bars, "2026-06-09")).toBeNull();
});
test("forwardReturn computes pct change over a calendar horizon", () => {
  expect(forwardReturn(bars, "2026-06-01", 7)).toBeCloseTo(0.10, 6);
});
test("forwardReturn is null when the horizon has not elapsed", () => {
  expect(forwardReturn(bars, "2026-06-05", 30)).toBeNull();
});
test("computeReturns produces excess = stock - spy per horizon", () => {
  const spy: OhlcBar[] = bars.map(b => ({ ...b, c: 100 }));
  const r = computeReturns(bars, spy, "2026-06-01");
  expect(r["1w"].stock).toBeCloseTo(0.10, 6);
  expect(r["1w"].spy).toBeCloseTo(0, 6);
  expect(r["1w"].excess).toBeCloseTo(0.10, 6);
  expect(r["toDate"].stock).toBeCloseTo(0.10, 6);
});
