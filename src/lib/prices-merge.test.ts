import { test, expect } from "bun:test";
import { mergePrices } from "./prices-merge";
import type { OhlcBar } from "./types";

const bar = (date: string, c: number): OhlcBar => ({ date, o: c, h: c, l: c, c });

test("unions by date and sorts ascending", () => {
  const a = [bar("2026-01-03", 3), bar("2026-01-01", 1)];
  const b = [bar("2026-01-02", 2)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 1), bar("2026-01-02", 2), bar("2026-01-03", 3)]);
});

test("incoming overrides existing for the same date", () => {
  const a = [bar("2026-01-01", 1)];
  const b = [bar("2026-01-01", 999)];
  expect(mergePrices(a, b)).toEqual([bar("2026-01-01", 999)]);
});

test("handles empty inputs", () => {
  expect(mergePrices([], [bar("2026-01-01", 1)])).toEqual([bar("2026-01-01", 1)]);
  expect(mergePrices([bar("2026-01-01", 1)], [])).toEqual([bar("2026-01-01", 1)]);
});
