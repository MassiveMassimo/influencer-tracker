import { test, expect } from "bun:test";
import { trimToLastSession, windowSeries } from "./window-series";

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

test("trimToLastSession keeps the latest regular ET session, aligned across stock+spy", () => {
  // EDT (June): 13:30Z = 09:30 ET (open), 19:55Z = 15:55 ET (still regular).
  const ohlc = [
    { date: "2026-06-15T13:30:00.000Z", c: 1 }, // prior session
    { date: "2026-06-16T13:30:00.000Z", c: 3 }, // last session open
    { date: "2026-06-16T19:55:00.000Z", c: 4 }, // last session, near close
  ];
  const spy = [
    { date: "2026-06-15T13:30:00.000Z", c: 10 },
    { date: "2026-06-16T13:30:00.000Z", c: 11 },
    { date: "2026-06-16T19:55:00.000Z", c: 12 },
  ];
  const r = trimToLastSession(ohlc, spy);
  expect(r.ohlc.map((b) => b.c)).toEqual([3, 4]);
  expect(r.spy.map((b) => b.c)).toEqual([11, 12]);
});

test("trimToLastSession drops pre-market: before the open, shows the prior full session", () => {
  // 08:00Z = 04:00 ET pre-market on the 17th — must NOT become the 1D session.
  const ohlc = [
    { date: "2026-06-16T13:30:00.000Z", c: 1 }, // 16th regular open
    { date: "2026-06-16T19:55:00.000Z", c: 2 }, // 16th near close
    { date: "2026-06-17T08:00:00.000Z", c: 99 }, // 17th pre-market (thin)
  ];
  const r = trimToLastSession(ohlc, []);
  expect(r.ohlc.map((b) => b.c)).toEqual([1, 2]);
});

test("trimToLastSession is DST-correct (EST winter open is 14:30Z)", () => {
  // Jan (EST, UTC-5): 13:30Z = 08:30 ET pre-market (drop); 14:30Z = 09:30 ET open.
  const ohlc = [
    { date: "2026-01-15T13:30:00.000Z", c: 1 }, // pre-market
    { date: "2026-01-15T14:30:00.000Z", c: 2 }, // open
    { date: "2026-01-15T20:55:00.000Z", c: 3 }, // 15:55 ET, regular
  ];
  const r = trimToLastSession(ohlc, []);
  expect(r.ohlc.map((b) => b.c)).toEqual([2, 3]);
});

test("trimToLastSession passes through when stock series is empty", () => {
  const spy = [{ date: "2026-06-16T13:30:00.000Z", c: 1 }];
  const r = trimToLastSession([], spy);
  expect(r.ohlc).toEqual([]);
  expect(r.spy).toBe(spy);
});
