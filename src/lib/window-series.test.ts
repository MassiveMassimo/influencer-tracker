import { test, expect } from "bun:test";
import { windowSeries } from "./window-series";

const bars = Array.from({ length: 400 }, (_, i) => {
  const d = new Date("2025-01-01T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + i);
  return { date: d.toISOString().slice(0, 10), c: i };
});

test("All returns every bar", () => {
  expect(windowSeries(bars, "All").length).toBe(400);
});

test("1M keeps ~last 30 days relative to last bar", () => {
  const w = windowSeries(bars, "1M");
  const last = bars[bars.length - 1].date;
  expect(w[w.length - 1].date).toBe(last);
  expect(w.length).toBeLessThanOrEqual(31);
  expect(w.length).toBeGreaterThan(0);
});

test("empty input returns empty", () => {
  expect(windowSeries([], "1Y")).toEqual([]);
});
