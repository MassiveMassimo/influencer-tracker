import { describe, expect, test } from "bun:test";
import { mean, median, pearson, skewness, stdev } from "./traits";

describe("stat helpers", () => {
  test("mean", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
  });

  test("stdev is population stdev, 0 on degenerate input", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
    expect(stdev([5])).toBe(0);
    expect(stdev([])).toBe(0);
  });

  test("median handles odd, even, empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  test("median does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });

  test("skewness: symmetric ~0, right-tailed positive, degenerate 0", () => {
    expect(skewness([-1, 0, 1])).toBeCloseTo(0, 10);
    // 19 small losses + 5 big wins: g1 ≈ 1.44 (population moments)
    const xs = [...Array(19).fill(-0.05), ...Array(5).fill(1)];
    expect(skewness(xs)).toBeGreaterThan(1);
    expect(skewness([1, 1])).toBe(0); // n < 3
    expect(skewness([2, 2, 2])).toBe(0); // zero variance
  });

  test("pearson: perfect +/-1, degenerate 0", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1], [1])).toBe(0); // n < 2
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0); // zero variance
  });
});
