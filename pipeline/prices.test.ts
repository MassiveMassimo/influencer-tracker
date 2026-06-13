import { describe, it, expect, test } from "bun:test";
import { cacheCovers, dropUnsettled, canonicalSymbols } from "./prices";
import type { ReelCall } from "../src/lib/types";

describe("cacheCovers", () => {
  const bars = [{ date: "2025-01-01", o:1,h:1,l:1,c:1 }, { date: "2025-02-01", o:1,h:1,l:1,c:1 }];
  it("true when earliest bar is at/before `from`", () => {
    expect(cacheCovers(bars, "2025-03-01")).toBe(true);
    expect(cacheCovers(bars, "2025-01-01")).toBe(true);
  });
  it("false when the cache starts after `from` (misses older history)", () => {
    expect(cacheCovers(bars, "2024-06-01")).toBe(false);
  });
  it("false for a 1-bar or empty or non-array cache", () => {
    expect(cacheCovers([bars[0]], "2024-01-01")).toBe(false);
    expect(cacheCovers([], "2024-01-01")).toBe(false);
    expect(cacheCovers(null, "2024-01-01")).toBe(false);
  });
});

describe("dropUnsettled", () => {
  const bar = (date: string) => ({ date, o: 1, h: 1, l: 1, c: 1 });
  it("drops today and later, keeps strictly-earlier bars", () => {
    const bars = [bar("2026-06-11"), bar("2026-06-12"), bar("2026-06-13")];
    expect(dropUnsettled(bars, "2026-06-13").map((b) => b.date)).toEqual(["2026-06-11", "2026-06-12"]);
  });
  it("keeps everything when all bars precede today", () => {
    expect(dropUnsettled([bar("2026-06-10")], "2026-06-13")).toHaveLength(1);
  });
});

const rc = (ticker: string): ReelCall => ({
  shortcode: ticker, postDate: "2026-01-01", ticker, company: ticker,
  direction: "bullish", isExplicitBuy: true, conviction: 1, quote: "", onScreenPrice: null, summary: "",
});

test("canonicalSymbols resolves, dedupes, drops null, and always includes SPY", () => {
  const got = canonicalSymbols([rc("BTCUSD"), rc("BTCUSDT"), rc("AAPL"), rc("SI1!")]);
  expect(got).toContain("BTC-USD"); // BTCUSD + BTCUSDT collapse to one
  expect(got).toContain("AAPL");
  expect(got).toContain("SPY");
  expect(got).not.toContain("SI1!"); // rejected
  expect(got.filter((s) => s === "BTC-USD")).toHaveLength(1); // deduped
});
