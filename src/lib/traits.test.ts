import { describe, expect, test } from "bun:test";
import type { Call } from "./types";
import { mean, median, pearson, skewness, stdev, traitsFor } from "./traits";

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

// Minimal Call factory. ex3 sets returns["3m"] = { stock: ex3+spy3, spy: spy3, excess: ex3 }.
let seq = 0;
function mk(over: {
  ticker: string;
  postDate: string;
  ex3?: number | null;
  spy3?: number | null;
  exToDate?: number | null;
  isFirstCall?: boolean;
  conviction?: number;
}): Call {
  const { ticker, postDate, ex3 = null, spy3 = 0.01, exToDate = null } = over;
  const nul = { stock: null, spy: null, excess: null };
  return {
    shortcode: `s${seq++}`,
    postDate,
    ticker,
    company: "",
    isFirstCall: over.isFirstCall ?? true,
    conviction: over.conviction ?? 0.5,
    quote: "",
    returns: {
      "1w": { ...nul },
      "1m": { ...nul },
      "3m": ex3 == null ? { ...nul } : { stock: ex3 + (spy3 ?? 0), spy: spy3, excess: ex3 },
      toDate: exToDate == null ? { ...nul } : { stock: exToDate, spy: 0, excess: exToDate },
    },
  };
}

// n first-calls on distinct tickers, one day apart, ex3 from fn.
function roster(
  n: number,
  ex3: (i: number) => number,
  opts?: { conviction?: (i: number) => number },
): Call[] {
  return Array.from({ length: n }, (_, i) =>
    mk({
      ticker: `T${i}`,
      postDate: `2025-01-${String((i % 31) + 1).padStart(2, "0")}`,
      ex3: ex3(i),
      conviction: opts?.conviction?.(i),
    }),
  );
}

const ids = (calls: Call[]) => traitsFor(calls).map((t) => t.id);

describe("traitsFor", () => {
  test("empty and tiny inputs earn nothing", () => {
    expect(traitsFor([])).toEqual([]);
    expect(ids(roster(5, () => 0.1))).toEqual([]);
  });

  test("laser-eyes: >60% crypto first-calls, n>=10", () => {
    const cryptos = ["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "ADA-USD", "XRP-USD", "AVAX-USD"];
    const calls = [
      ...cryptos.map((t, i) => mk({ ticker: t, postDate: `2025-01-0${i + 1}`, ex3: 0.01 })),
      mk({ ticker: "AAPL", postDate: "2025-02-01", ex3: 0.01 }),
      mk({ ticker: "NVDA", postDate: "2025-02-02", ex3: 0.01 }),
      mk({ ticker: "TSLA", postDate: "2025-02-03", ex3: 0.01 }),
    ];
    expect(ids(calls)).toContain("laser-eyes");
    // 9 calls (below guard) → not earned
    expect(ids(calls.slice(0, 9))).not.toContain("laser-eyes");
  });

  test("lottery-ticket: positive skew with negative median, n>=20", () => {
    // 19 small losers + 5 moonshots: skew ≈ 1.44 > 1, median -0.05 < 0
    const calls = roster(24, (i) => (i < 19 ? -0.05 : 1));
    expect(ids(calls)).toContain("lottery-ticket");
    // Symmetric outcomes → not earned
    expect(ids(roster(24, (i) => (i % 2 ? 0.1 : -0.1)))).not.toContain("lottery-ticket");
  });

  test("bull-only: wins only when SPY is up, >=8 calls per regime", () => {
    const up = Array.from({ length: 8 }, (_, i) =>
      mk({ ticker: `U${i}`, postDate: `2025-01-0${i + 1}`, ex3: 0.05, spy3: 0.02 }),
    );
    const down = Array.from({ length: 8 }, (_, i) =>
      mk({ ticker: `D${i}`, postDate: `2025-02-0${i + 1}`, ex3: -0.05, spy3: -0.02 }),
    );
    expect(ids([...up, ...down])).toContain("bull-only");
    // 7 down-regime calls (below guard) → not earned
    expect(ids([...up, ...down.slice(0, 7)])).not.toContain("bull-only");
  });

  test("rising-star / fallen-star: half-career delta, n>=30, mutually exclusive", () => {
    const rising = roster(30, (i) => (i < 15 ? -0.05 : 0.05));
    expect(ids(rising)).toContain("rising-star");
    expect(ids(rising)).not.toContain("fallen-star");
    const falling = roster(30, (i) => (i < 15 ? 0.05 : -0.05));
    expect(ids(falling)).toContain("fallen-star");
    expect(ids(falling)).not.toContain("rising-star");
    // Flat career → neither
    expect(ids(roster(30, () => 0.01))).not.toContain("rising-star");
  });

  test("calibrated / confidently-wrong: conviction-excess correlation, n>=30", () => {
    const calib = roster(30, (i) => i / 30 - 0.5, { conviction: (i) => i / 30 });
    expect(ids(calib)).toContain("calibrated");
    const wrong = roster(30, (i) => 0.5 - i / 30, { conviction: (i) => i / 30 });
    expect(ids(wrong)).toContain("confidently-wrong");
    // Flat conviction (stdev guard) → neither
    const flat = roster(30, (i) => i / 30 - 0.5, { conviction: () => 0.9 });
    expect(ids(flat)).not.toContain("calibrated");
  });

  test("null-3m calls are ignored; below-guard traits stay unearned", () => {
    // 18 calls carry a 3m excess shaped like a lottery winner; 7 more have null 3m.
    // Scored n = 18 is below the lottery (20) and trajectory/calibration (30) guards.
    const withEx = roster(18, (i) => (i < 14 ? -0.05 : 1));
    const nullEx = Array.from({ length: 7 }, (_, i) =>
      mk({ ticker: `N${i}`, postDate: `2025-06-${String(i + 1).padStart(2, "0")}`, ex3: null }),
    );
    const got = ids([...withEx, ...nullEx]); // must not throw on the null-excess rows
    expect(got).not.toContain("lottery-ticket");
    expect(got).not.toContain("rising-star");
    expect(got).not.toContain("fallen-star");
    expect(got).not.toContain("calibrated");
    expect(got).not.toContain("confidently-wrong");
  });

  test("results are priority-ordered and input is not mutated", () => {
    // Earns calibrated (conviction-excess corr) and rising-star (improving halves) at once.
    const calls = roster(30, (i) => (i < 15 ? -0.2 + i * 0.01 : 0.05 + i * 0.01), {
      conviction: (i) => i / 30,
    });
    const snapshot = [...calls];
    const got = ids(calls);
    expect(calls).toEqual(snapshot); // no mutation
    expect(got).toContain("calibrated");
    expect(got).toContain("rising-star");
    // calibrated outranks rising-star in display priority
    expect(got.indexOf("calibrated")).toBeLessThan(got.indexOf("rising-star"));
  });
});
