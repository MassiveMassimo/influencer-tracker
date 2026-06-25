import { test, expect } from "bun:test";
import { assembleDataset } from "./score";
import { applyOverrides } from "./overrides";
import type { ReelCall, OhlcBar } from "../src/lib/types";

test("assembleDataset scores calls and validates against schema", () => {
  const reelCalls: ReelCall[] = [{
    shortcode: "DZDmQutB0Ep", postDate: "2026-06-01", ticker: "NBIS",
    company: "Nebius Group N.V.", direction: "bullish", isExplicitBuy: true,
    conviction: 0.9, quote: "buy right here", onScreenPrice: 273.01, summary: "Bullish on Nebius.",
  }];
  const nbis: OhlcBar[] = [
    { date: "2026-06-01", o: 100, h: 100, l: 100, c: 100 },
    { date: "2026-06-08", o: 110, h: 110, l: 110, c: 110 },
  ];
  const spy: OhlcBar[] = [
    { date: "2026-06-01", o: 50, h: 50, l: 50, c: 50 },
    { date: "2026-06-08", o: 50, h: 50, l: 50, c: 50 },
  ];
  const ds = assembleDataset({ handle: "kevvonz", name: "Kevin Hu" },
    reelCalls, { NBIS: nbis, SPY: spy }, "2026-06-09");
  expect(ds.calls[0].isFirstCall).toBe(true);
  expect(ds.calls[0].returns["1w"].excess).toBeCloseTo(0.10, 6);
  expect(ds.scorecard.totalCalls).toBe(1);
  expect(ds.calls[0].spark).toEqual([100, 110]);
  expect((ds as unknown as { tickers?: unknown }).tickers).toBeUndefined();
});

const bar = (date: string, c: number): OhlcBar => ({ date, o: c, h: c, l: c, c });
const spyBars: OhlcBar[] = [bar("2026-06-01", 50), bar("2026-06-08", 50)];
const cryptoCall = (ticker: string): ReelCall => ({
  shortcode: ticker, postDate: "2026-06-01", ticker, company: "Bitcoin",
  direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "buy",
  onScreenPrice: null, summary: "x",
});

test("a call's raw crypto ticker is scored against the canonical symbol's bars", () => {
  const ds = assembleDataset({ handle: "h", name: "n" }, [cryptoCall("BTCUSD")],
    { "BTC-USD": [bar("2026-06-01", 100), bar("2026-06-08", 110)], SPY: spyBars }, "2026-06-09");
  expect(ds.calls).toHaveLength(1);
  expect(ds.calls[0].ticker).toBe("BTC-USD"); // canonical emitted, not raw BTCUSD
  expect(ds.calls[0].returns["1w"].excess).toBeCloseTo(0.10, 6);
  expect(ds.caveats).toContain("crypto-vs-spy"); // disclosed because crypto present
});

test("a call resolving to null is excluded from the dataset", () => {
  const ds = assembleDataset({ handle: "h", name: "n" }, [cryptoCall("SI1!")],
    { SPY: spyBars }, "2026-06-09");
  expect(ds.calls).toHaveLength(0);
});

test("a resolvable call with no price bars is excluded", () => {
  const ds = assembleDataset({ handle: "h", name: "n" }, [cryptoCall("ZZZZ")],
    { SPY: spyBars }, "2026-06-09"); // ZZZZ resolves to ZZZZ but no bars present
  expect(ds.calls).toHaveLength(0);
});

test("an out-of-scope symbol (per the injected predicate) is excluded though it prices fine", () => {
  const bars = { VOO: [bar("2026-06-01", 100), bar("2026-06-08", 110)], SPY: spyBars };
  const call: ReelCall = { shortcode: "v", postDate: "2026-06-01", ticker: "VOO", company: "Vanguard S&P 500 ETF",
    direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "buy", onScreenPrice: null, summary: "x" };
  // Default predicate keeps it (priceable); the scope predicate drops it.
  expect(assembleDataset({ handle: "h", name: "n" }, [call], bars, "2026-06-09").calls).toHaveLength(1);
  expect(assembleDataset({ handle: "h", name: "n" }, [call], bars, "2026-06-09", undefined, "Reels",
    sym => sym !== "VOO").calls).toHaveLength(0);
});

test("an equities-only dataset omits the crypto caveat", () => {
  const ds = assembleDataset({ handle: "h", name: "n" },
    [{ shortcode: "a", postDate: "2026-06-01", ticker: "AAPL", company: "Apple",
       direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "q",
       onScreenPrice: null, summary: "s" }],
    { AAPL: [bar("2026-06-01", 100), bar("2026-06-08", 110)], SPY: spyBars }, "2026-06-09");
  expect(ds.calls).toHaveLength(1);
  expect(ds.caveats).not.toContain("crypto-vs-spy");
});

test("applyOverrides feeds assembleDataset: an override flips a call out of scoring", () => {
  const reelCalls: ReelCall[] = [{ shortcode: "a", postDate: "2026-06-01", ticker: "AAPL",
    company: "Apple", direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "q",
    onScreenPrice: null, summary: "s" }];
  const ohlc = { AAPL: [bar("2026-06-01", 100), bar("2026-06-08", 110)], SPY: spyBars };
  const corrected = applyOverrides(reelCalls, [{ handle: "h", shortcode: "a", targetTicker: "", ticker: null,
    isExplicitBuy: false, direction: null, reason: "not a buy" }]);
  expect(assembleDataset({ handle: "h", name: "n" }, corrected, ohlc, "2026-06-09").calls).toHaveLength(0);
});

test("two raw crypto tickers collapse to one canonical first-call (gate before dedup)", () => {
  const bars = [bar("2026-06-01", 100), bar("2026-06-05", 105), bar("2026-06-08", 110)];
  const spy3 = [bar("2026-06-01", 50), bar("2026-06-05", 50), bar("2026-06-08", 50)];
  const calls: ReelCall[] = [
    { shortcode: "early", postDate: "2026-06-01", ticker: "BTCUSD", company: "Bitcoin",
      direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "q", onScreenPrice: null, summary: "s" },
    { shortcode: "late", postDate: "2026-06-05", ticker: "BTC", company: "Bitcoin",
      direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "q", onScreenPrice: null, summary: "s" },
  ];
  const ds = assembleDataset({ handle: "h", name: "n" }, calls,
    { "BTC-USD": bars, SPY: spy3 }, "2026-06-09");
  expect(ds.calls.every(c => c.ticker === "BTC-USD")).toBe(true);
  expect(ds.scorecard.uniqueTickers).toBe(1);
  const firsts = ds.calls.filter(c => c.isFirstCall);
  expect(firsts).toHaveLength(1);
  expect(firsts[0].shortcode).toBe("early");
});

test("nameFor resolver overrides company per canonical symbol; falls back to LLM company", () => {
  const nvdaBars = [bar("2026-06-01", 100), bar("2026-06-08", 120)];
  const amdBars = [bar("2026-06-01", 50), bar("2026-06-08", 55)];
  const calls: ReelCall[] = [
    { shortcode: "p1", postDate: "2026-06-01", ticker: "NVDA", company: "", // LLM left it blank
      direction: "bullish", isExplicitBuy: true, conviction: 0.9, quote: "q", onScreenPrice: null, summary: "s" },
    { shortcode: "p1", postDate: "2026-06-01", ticker: "AMD", company: "AMD", // LLM-supplied, no Yahoo name
      direction: "bullish", isExplicitBuy: true, conviction: 0.8, quote: "q", onScreenPrice: null, summary: "s" },
  ];
  const nameFor = (sym: string) => (sym === "NVDA" ? "NVIDIA" : undefined);
  const ds = assembleDataset({ handle: "h", name: "n" }, calls,
    { NVDA: nvdaBars, AMD: amdBars, SPY: spyBars }, "2026-06-09", undefined, "Reels", undefined, nameFor);
  const byTicker = Object.fromEntries(ds.calls.map(c => [c.ticker, c.company]));
  expect(byTicker.NVDA).toBe("NVIDIA");   // Yahoo name wins over blank
  expect(byTicker.AMD).toBe("AMD");        // no Yahoo name → LLM company kept
});

test("one post naming multiple stocks scores one call per ticker (same shortcode)", () => {
  const nvdaBars = [bar("2026-06-01", 100), bar("2026-06-08", 120)];
  const amdBars = [bar("2026-06-01", 50), bar("2026-06-08", 55)];
  const calls: ReelCall[] = [
    { shortcode: "post1", postDate: "2026-06-01", ticker: "NVDA", company: "Nvidia",
      direction: "bullish", isExplicitBuy: true, conviction: 0.9, quote: "buy NVDA", onScreenPrice: null, summary: "s" },
    { shortcode: "post1", postDate: "2026-06-01", ticker: "AMD", company: "AMD",
      direction: "bullish", isExplicitBuy: true, conviction: 0.8, quote: "buy AMD", onScreenPrice: null, summary: "s" },
  ];
  const ds = assembleDataset({ handle: "h", name: "n" }, calls,
    { NVDA: nvdaBars, AMD: amdBars, SPY: spyBars }, "2026-06-09");
  expect(ds.calls.map(c => c.ticker).sort()).toEqual(["AMD", "NVDA"]);
  expect(ds.calls.every(c => c.shortcode === "post1")).toBe(true);
});

test("same canonical symbol twice in one post collapses, keeping highest conviction", () => {
  const bars = [bar("2026-06-01", 100), bar("2026-06-08", 110)];
  const calls: ReelCall[] = [
    { shortcode: "post1", postDate: "2026-06-01", ticker: "BTC", company: "Bitcoin",
      direction: "bullish", isExplicitBuy: true, conviction: 0.5, quote: "low", onScreenPrice: null, summary: "s" },
    { shortcode: "post1", postDate: "2026-06-01", ticker: "BTCUSD", company: "Bitcoin",
      direction: "bullish", isExplicitBuy: true, conviction: 0.9, quote: "high", onScreenPrice: null, summary: "s" },
  ];
  const ds = assembleDataset({ handle: "h", name: "n" }, calls, { "BTC-USD": bars, SPY: spyBars }, "2026-06-09");
  expect(ds.calls).toHaveLength(1);
  expect(ds.calls[0].ticker).toBe("BTC-USD");
  expect(ds.calls[0].conviction).toBe(0.9);
  expect(ds.calls[0].quote).toBe("high");
});
