import { test, expect } from "bun:test";
import { wouldShrink } from "./guard-no-shrink";
test("flags a shrink below tolerance", () => {
  expect(wouldShrink(100, 80)).toBe(true); // 80 < 100*0.95
  expect(wouldShrink(100, 99)).toBe(false); // within tolerance
  expect(wouldShrink(0, 0)).toBe(false);
});
