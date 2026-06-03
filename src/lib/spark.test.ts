import { test, expect } from "bun:test";
import { buildSpark } from "./spark";
import type { OhlcBar } from "./types";

const bar = (date: string, c: number): OhlcBar => ({ date, o: c, h: c, l: c, c });

test("returns closes from fromDate forward", () => {
  const ohlc = [bar("2026-01-01", 10), bar("2026-02-01", 20), bar("2026-03-01", 30)];
  expect(buildSpark(ohlc, "2026-02-01")).toEqual([20, 30]);
});

test("includes the bar exactly on fromDate", () => {
  const ohlc = [bar("2026-01-01", 10), bar("2026-01-02", 11)];
  expect(buildSpark(ohlc, "2026-01-01")).toEqual([10, 11]);
});

test("returns empty when no bars on/after fromDate", () => {
  expect(buildSpark([bar("2026-01-01", 10)], "2027-01-01")).toEqual([]);
});

test("downsamples to maxPoints, keeping first and last", () => {
  const ohlc = Array.from({ length: 100 }, (_, i) => bar(`2026-01-${i + 1}`, i));
  const spark = buildSpark(ohlc, "2026-01-1", 24);
  expect(spark.length).toBe(24);
  expect(spark[0]).toBe(0);
  expect(spark[spark.length - 1]).toBe(99);
});

test("does not downsample when already at or under maxPoints", () => {
  const ohlc = [bar("2026-01-01", 1), bar("2026-01-02", 2), bar("2026-01-03", 3)];
  expect(buildSpark(ohlc, "2026-01-01", 24)).toEqual([1, 2, 3]);
});
