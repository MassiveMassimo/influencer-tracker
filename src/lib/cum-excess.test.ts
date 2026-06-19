import { describe, expect, test } from "bun:test";
import { buildCumExcess } from "./cum-excess";
import { computeReturns } from "./returns";
import type { Call, OhlcBar } from "./types";

// Daily OHLC from a list of closes (o=h=l=c; only closes matter here).
function bars(startISO: string, closes: number[]): OhlcBar[] {
  const base = new Date(startISO + "T00:00:00Z");
  return closes.map((c, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), o: c, h: c, l: c, c };
  });
}

function call(ticker: string, postDate: string): Call {
  return {
    shortcode: `${ticker}-${postDate}`, postDate, ticker, company: ticker,
    isFirstCall: true, conviction: 0.5, quote: "", onScreenPrice: null,
    returns: {} as Call["returns"], // unused by buildCumExcess
  };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

describe("buildCumExcess", () => {
  test("returns [] when SPY is empty or no first-calls qualify", () => {
    const spy = bars("2026-01-01", [100, 101, 102]);
    expect(buildCumExcess([call("A", "2026-01-01")], { A: bars("2026-01-01", [10, 11, 12]) }, [])).toEqual([]);
    expect(buildCumExcess([], {}, spy)).toEqual([]);
    // isFirstCall:false is ignored
    const notFirst = { ...call("A", "2026-01-01"), isFirstCall: false };
    expect(buildCumExcess([notFirst], { A: bars("2026-01-01", [10, 11]) }, spy)).toEqual([]);
  });

  test("endpoint equals the per-call to-date excess (computeReturns oracle)", () => {
    const spy = bars("2026-01-01", [100, 100, 100, 100, 100, 110]); // +10% SPY
    const stock = bars("2026-01-01", [10, 11, 12, 13, 14, 15]); // +50% stock
    const series = buildCumExcess([call("A", "2026-01-01")], { A: stock }, spy);
    const expected = computeReturns(stock, spy, "2026-01-01").toDate.excess!;
    expect(series.at(-1)!.v).toBeCloseTo(round4(expected), 4);
    // first active day: stock and SPY both at entry → flat
    expect(series[0]!.v).toBe(0);
    // ascending dates
    expect(series.map((p) => p.t)).toEqual(series.map((p) => p.t).sort());
  });

  test("equal-weights staggered calls; endpoint is the mean of per-call to-date excess", () => {
    const spy = bars("2026-01-01", Array.from({ length: 10 }, (_, i) => 100 + i)); // slow grind up
    const a = bars("2026-01-01", Array.from({ length: 10 }, (_, i) => 10 + 2 * i)); // strong
    const b = bars("2026-01-01", Array.from({ length: 10 }, () => 50)); // flat, enters later
    const calls = [call("A", "2026-01-01"), call("B", "2026-01-06")];
    const series = buildCumExcess(calls, { A: a, B: b }, spy);
    const exA = computeReturns(a, spy, "2026-01-01").toDate.excess!;
    const exB = computeReturns(b, spy, "2026-01-06").toDate.excess!;
    expect(series.at(-1)!.v).toBeCloseTo(round4((exA + exB) / 2), 4);
    // B only enters on its post date — before that the curve is A alone
    expect(series.find((p) => p.t === "2026-01-03")).toBeDefined();
  });

  test("excludes a call whose price series starts more than a week after the post date", () => {
    const spy = bars("2026-01-01", [100, 101, 102, 103]);
    const late = bars("2026-01-15", [10, 11, 12, 13]); // first bar 14d after postDate
    expect(buildCumExcess([call("A", "2026-01-01")], { A: late }, spy)).toEqual([]);
  });

  test("downsamples to maxPoints, keeping first and last points", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i);
    const spy = bars("2026-01-01", closes);
    const stock = bars("2026-01-01", closes.map((c) => c * 1.2));
    const series = buildCumExcess([call("A", "2026-01-01")], { A: stock }, spy, 90);
    expect(series.length).toBe(90);
    expect(series[0]!.t).toBe(spy[0]!.date);
    expect(series.at(-1)!.t).toBe(spy.at(-1)!.date);
  });
});
