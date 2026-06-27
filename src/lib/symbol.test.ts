import { test, expect } from "bun:test";
import { resolveSymbol } from "./symbol";

test("crypto notations collapse to <BASE>-USD", () => {
  for (const raw of ["BTC", "BTCUSD", "BTCUSDT", "BTC.X", "$BTC"]) {
    expect(resolveSymbol(raw)).toBe("BTC-USD");
  }
  for (const raw of ["ETH", "ETHUSD", "ETH.X", "$ETH.X"]) {
    expect(resolveSymbol(raw)).toBe("ETH-USD");
  }
});

test("foreign listing gets its Yahoo suffix", () => {
  expect(resolveSymbol("HEIA")).toBe("HEIA.AS");
});

test("out-of-scope notations resolve to null", () => {
  expect(resolveSymbol("SI1!")).toBeNull(); // continuous future
  expect(resolveSymbol("SPCFD")).toBeNull(); // CFD
});

test("normal equities pass through unchanged", () => {
  expect(resolveSymbol("AAPL")).toBe("AAPL");
  expect(resolveSymbol("BRK-B")).toBe("BRK-B");
});

test("non-crypto short tickers are NOT mistaken for crypto", () => {
  // Guards against pattern-matching (e.g. /^[A-Z]{3}$/) regressions.
  expect(resolveSymbol("IBM")).toBe("IBM");
  expect(resolveSymbol("MMM")).toBe("MMM");
});

test("resolution is idempotent", () => {
  for (const raw of ["BTCUSD", "BTC", "HEIA", "AAPL", "BTC-USD", "HEIA.AS"]) {
    const once = resolveSymbol(raw);
    if (once != null) expect(resolveSymbol(once)).toBe(once);
  }
});

test("blank input is null", () => {
  expect(resolveSymbol("")).toBeNull();
  expect(resolveSymbol("  ")).toBeNull();
});
