import { describe, it, expect } from "bun:test";
import { toLiveBars, cacheGet, cacheSet, type RawQuote } from "./chart-fetch.ts";

describe("toLiveBars", () => {
  it("maps quotes to ISO-datetime bars and drops incomplete rows", () => {
    const quotes: RawQuote[] = [
      { date: new Date("2026-06-03T13:30:00Z"), open: 10, high: 11, low: 9, close: 10.5 },
      { date: new Date("2026-06-03T13:35:00Z"), open: null, high: 11, low: 9, close: 10.5 },
      { date: new Date("2026-06-03T13:40:00Z"), open: 10.5, high: 12, low: 10, close: 11 },
    ];
    const bars = toLiveBars(quotes);
    expect(bars).toEqual([
      { date: "2026-06-03T13:30:00.000Z", o: 10, h: 11, l: 9, c: 10.5 },
      { date: "2026-06-03T13:40:00.000Z", o: 10.5, h: 12, l: 10, c: 11 },
    ]);
  });
});

describe("cache", () => {
  it("returns a fresh entry and expires a stale one", () => {
    const bars = [{ date: "2026-06-03T13:30:00.000Z", o: 1, h: 1, l: 1, c: 1 }];
    const t0 = 1_000_000;
    cacheSet("AAPL:5m", bars, t0);
    expect(cacheGet("AAPL:5m", t0 + 60_000)).toEqual(bars); // 1 min later: fresh
    expect(cacheGet("AAPL:5m", t0 + 6 * 60_000)).toBeNull(); // 6 min later: stale
    expect(cacheGet("MISS:5m", t0)).toBeNull();
  });

  it("treats exactly TTL as still fresh, one ms past as stale", () => {
    const bars = [{ date: "2026-06-03T13:30:00.000Z", o: 1, h: 1, l: 1, c: 1 }];
    const t0 = 2_000_000;
    cacheSet("X:1d", bars, t0);
    expect(cacheGet("X:1d", t0 + 5 * 60_000)).toEqual(bars);     // exactly 5 min: fresh
    expect(cacheGet("X:1d", t0 + 5 * 60_000 + 1)).toBeNull();    // 1 ms past: stale
  });
});
