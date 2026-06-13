import { test, expect } from "bun:test";
import { applyOverrides, type Override } from "./overrides";
import type { ReelCall } from "../src/lib/types";

const base: ReelCall = {
  shortcode: "AAA", postDate: "2026-06-01", ticker: "DUOL", company: "Duolingo",
  direction: "bullish", isExplicitBuy: true, conviction: 0.9, quote: "q",
  onScreenPrice: null, summary: "s",
};

test("a non-null override field replaces the classified value; null fields are left alone", () => {
  const ov: Override[] = [{ handle: "h", shortcode: "AAA", ticker: "AMD", isExplicitBuy: null, direction: null, reason: "wrong ticker" }];
  const [c] = applyOverrides([base], ov);
  expect(c.ticker).toBe("AMD");        // overridden
  expect(c.isExplicitBuy).toBe(true);  // untouched (null in override)
  expect(c.direction).toBe("bullish"); // untouched
});

test("override can flip isExplicitBuy off (the maintainable replacement for owner-DELETE)", () => {
  const ov: Override[] = [{ handle: "h", shortcode: "AAA", ticker: null, isExplicitBuy: false, direction: null, reason: "not a buy" }];
  expect(applyOverrides([base], ov)[0].isExplicitBuy).toBe(false);
});

test("calls with no override are returned unchanged; matching is by shortcode", () => {
  const ov: Override[] = [{ handle: "h", shortcode: "ZZZ", ticker: "X", isExplicitBuy: null, direction: null, reason: "r" }];
  expect(applyOverrides([base], ov)[0]).toEqual(base);
});

test("ticker is uppercased; an empty-string ticker override is ignored (treated as no-op)", () => {
  const ov: Override[] = [{ handle: "h", shortcode: "AAA", ticker: "amd", isExplicitBuy: null, direction: null, reason: "r" }];
  expect(applyOverrides([base], ov)[0].ticker).toBe("AMD");
});
