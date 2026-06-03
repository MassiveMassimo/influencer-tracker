import { describe, it, expect } from "bun:test";
import { toReelCall, buildReview, type Classification } from "./calls";

const base: Classification = {
  ticker: "nbis", company: "Nebius", direction: "bullish",
  isExplicitBuy: true, conviction: 0.8, quote: "load up on NBIS", onScreenPrice: 65.1,
  summary: "Bullish on NBIS.",
};

describe("toReelCall", () => {
  it("uppercases ticker and maps fields", () => {
    const rc = toReelCall(base, "tweet123", "2026-01-15");
    expect(rc).toMatchObject({
      shortcode: "tweet123", postDate: "2026-01-15", ticker: "NBIS",
      company: "Nebius", direction: "bullish", isExplicitBuy: true,
      conviction: 0.8, quote: "load up on NBIS", onScreenPrice: 65.1,
    });
  });
  it("returns null when no ticker", () => {
    expect(toReelCall({ ...base, ticker: null }, "t", "2026-01-15")).toBeNull();
  });
  it("applies defaults for missing optional fields", () => {
    const rc = toReelCall({ ticker: "AAPL" } as Classification, "t", "2026-01-15");
    expect(rc).toMatchObject({ company: "", direction: "neutral", isExplicitBuy: false, conviction: 0, quote: "", onScreenPrice: null });
  });
});

describe("buildReview", () => {
  it("counts explicit bullish calls and renders rows", () => {
    const md = buildReview([
      toReelCall(base, "t1", "2026-01-15")!,
      toReelCall({ ...base, ticker: "AAPL", direction: "neutral", isExplicitBuy: false }, "t2", "2026-02-01")!,
    ]);
    expect(md).toContain("Explicit bullish calls: 1");
    expect(md).toContain("NBIS");
    expect(md).toContain("| date | ticker |");
  });
});
