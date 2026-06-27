import { test, expect } from "bun:test";
import { applyOverrides, type Override } from "./overrides";
import type { ReelCall } from "../src/lib/types";

const base: ReelCall = {
  shortcode: "AAA",
  postDate: "2026-06-01",
  ticker: "DUOL",
  company: "Duolingo",
  direction: "bullish",
  isExplicitBuy: true,
  conviction: 0.9,
  quote: "q",
  onScreenPrice: null,
  summary: "s",
};

// targetTicker "" = legacy whole-post override (applies to the sole call in the post).
const ov = (o: Partial<Override>): Override => ({
  handle: "h",
  shortcode: "AAA",
  targetTicker: "",
  ticker: null,
  isExplicitBuy: null,
  direction: null,
  reason: "r",
  ...o,
});

test("a non-null override field replaces the classified value; null fields are left alone", () => {
  const [c] = applyOverrides([base], [ov({ ticker: "AMD", reason: "wrong ticker" })]);
  expect(c.ticker).toBe("AMD"); // overridden
  expect(c.isExplicitBuy).toBe(true); // untouched (null in override)
  expect(c.direction).toBe("bullish"); // untouched
});

test("override can flip isExplicitBuy off (the maintainable replacement for owner-DELETE)", () => {
  expect(
    applyOverrides([base], [ov({ isExplicitBuy: false, reason: "not a buy" })])[0].isExplicitBuy,
  ).toBe(false);
});

test("calls with no override are returned unchanged; matching is by shortcode", () => {
  expect(applyOverrides([base], [ov({ shortcode: "ZZZ", ticker: "X" })])[0]).toEqual(base);
});

test("ticker is uppercased", () => {
  expect(applyOverrides([base], [ov({ ticker: "amd" })])[0].ticker).toBe("AMD");
});

test("targetTicker pins an override to one call within a multi-stock post", () => {
  const nvda: ReelCall = { ...base, ticker: "NVDA" };
  const amd: ReelCall = { ...base, ticker: "AMD" };
  // Flip only AMD off; NVDA must be untouched.
  const out = applyOverrides([nvda, amd], [ov({ targetTicker: "AMD", isExplicitBuy: false })]);
  expect(out.find((c) => c.ticker === "NVDA")!.isExplicitBuy).toBe(true);
  expect(out.find((c) => c.ticker === "AMD")!.isExplicitBuy).toBe(false);
});

test("targetTicker matches by canonical symbol (BTC targets a BTCUSD-classified call)", () => {
  const btc: ReelCall = { ...base, ticker: "BTCUSD" };
  const [c] = applyOverrides([btc], [ov({ targetTicker: "BTC", isExplicitBuy: false })]);
  expect(c.isExplicitBuy).toBe(false);
});

test("a ticker-specific override wins over a legacy whole-post one", () => {
  const amd: ReelCall = { ...base, ticker: "AMD" };
  const out = applyOverrides(
    [amd],
    [
      ov({ targetTicker: "", direction: "bearish" }), // legacy whole-post
      ov({ targetTicker: "AMD", direction: "neutral" }), // specific
    ],
  );
  expect(out[0].direction).toBe("neutral");
});
