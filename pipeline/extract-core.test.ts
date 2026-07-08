import { describe, it, expect } from "bun:test";
import { dedupeCalls, callKey } from "./extract-core";
import type { ReelCall } from "../src/lib/types";

describe("callKey", () => {
  it("combines shortcode and ticker", () => {
    expect(callKey({ shortcode: "t1", ticker: "NVDA" } as ReelCall)).toBe("t1:NVDA");
  });
});

describe("dedupeCalls", () => {
  const mk = (shortcode: string, ticker: string): ReelCall => ({
    shortcode,
    postDate: "2026-01-01",
    ticker,
    company: "",
    direction: "bullish",
    isExplicitBuy: true,
    conviction: 0.5,
    quote: "",
    onScreenPrice: null,
    summary: "",
  });
  it("keeps the first occurrence and drops later duplicates by (shortcode, ticker)", () => {
    const out = dedupeCalls([mk("t1", "AAA"), mk("t1", "AAA"), mk("t2", "CCC")]);
    expect(out.map((c) => `${c.shortcode}:${c.ticker}`)).toEqual(["t1:AAA", "t2:CCC"]);
  });
  it("keeps two different tickers on the same post (multi-stock)", () => {
    const out = dedupeCalls([mk("t1", "AAA"), mk("t1", "BBB")]);
    expect(out.map((c) => c.ticker)).toEqual(["AAA", "BBB"]);
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeCalls([])).toEqual([]);
  });
});
