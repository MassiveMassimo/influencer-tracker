import { describe, expect, test } from "bun:test";
import { gradeFor } from "./grade";
import type { Call, Horizon, ReturnTriple, Scorecard } from "./types";

// Fixture helpers. Tests construct the scorecard directly (full control over
// pooled stats) and a matching calls array for per-call signals.
export function rt(excess: number | null): ReturnTriple {
  return { stock: excess, spy: 0, excess };
}

export function mkCall(over: {
  e1w?: number | null;
  e1m?: number | null;
  e3m?: number | null;
  isFirstCall?: boolean;
}): Call {
  const returns: Record<Horizon, ReturnTriple> = {
    "1w": rt(over.e1w ?? null),
    "1m": rt(over.e1m ?? null),
    "3m": rt(over.e3m ?? null),
    toDate: rt(null),
  };
  return {
    shortcode: "x",
    postDate: "2026-01-01",
    ticker: "TCK",
    company: "",
    isFirstCall: over.isFirstCall ?? true,
    conviction: 1,
    quote: "",
    returns,
  };
}

// n scored calls, each with the given 1m/3m excess.
export function mkCalls(n: number, e1m: number | null, e3m: number | null, e1w = 0.01): Call[] {
  return Array.from({ length: n }, () => mkCall({ e1w, e1m, e3m }));
}

export function mkSc(over: Partial<Scorecard>): Scorecard {
  return {
    totalCalls: 20,
    uniqueTickers: 20,
    hitRate: { "1m": 0.5, "3m": 0.5 },
    hitRateN: { "1m": 20, "3m": 20 },
    avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
    callsPerWeek: 1,
    best: [],
    worst: [],
    ...over,
  };
}

describe("gradeFor score + bands + gate", () => {
  test("market-matching creator anchors to C at score 50", () => {
    const g = gradeFor(mkSc({}), mkCalls(20, 0, 0));
    expect(g?.score).toBe(50);
    expect(g?.grade).toBe("C");
    expect(g?.letter).toBe("C");
  });

  test("sample gate: 9 scored calls -> null, 10 -> graded", () => {
    expect(gradeFor(mkSc({}), mkCalls(9, 0, 0))).toBeNull();
    expect(gradeFor(mkSc({}), mkCalls(10, 0, 0))).not.toBeNull();
  });

  test("non-first calls do not count toward the gate", () => {
    const calls = [...mkCalls(9, 0, 0), mkCall({ e1m: 0, e3m: 0, isFirstCall: false })];
    expect(gradeFor(mkSc({}), calls)).toBeNull();
  });

  test("hit rate pools by sample size across horizons", () => {
    // 1m: 100% of 30, 3m: 0% of 10 -> pooled 0.75 -> +25 pts -> 75 -> B+
    const sc = mkSc({
      hitRate: { "1m": 1, "3m": 0 },
      hitRateN: { "1m": 30, "3m": 10 },
    });
    const g = gradeFor(sc, mkCalls(30, 0, 0));
    expect(g?.score).toBe(75);
    expect(g?.grade).toBe("B+");
  });

  test("excess is clamped at +/-25% so a moonshot cannot exceed the cap", () => {
    const capped = gradeFor(
      mkSc({ avgExcess: { "1w": 0, "1m": 0.25, "3m": 0.25, toDate: 0 } }),
      mkCalls(20, 0.25, 0.25),
    );
    const moon = gradeFor(
      mkSc({ avgExcess: { "1w": 0, "1m": 2, "3m": 2, toDate: 0 } }),
      mkCalls(20, 2, 2),
    );
    expect(moon?.score).toBe(capped?.score); // both hit the cap: 50 + 2*25 = 100
    expect(moon?.score).toBe(100);
    expect(moon?.grade).toBe("A+");
  });

  test("score clamps to 0 and maps to F", () => {
    const g = gradeFor(
      mkSc({
        hitRate: { "1m": 0, "3m": 0 },
        avgExcess: { "1w": 0, "1m": -0.5, "3m": -0.5, toDate: 0 },
      }),
      mkCalls(20, -0.5, -0.5),
    );
    expect(g?.score).toBe(0);
    expect(g?.grade).toBe("F");
  });

  test("bands map correctly", () => {
    // score = 50 + (hit-0.5)*100, excess 0. Hits sit 0.2 pts above each cutoff:
    // exact-cutoff inputs are float-hazardous (0.19-0.5 can round below the band).
    const at = (hit: number) =>
      gradeFor(mkSc({ hitRate: { "1m": hit, "3m": hit } }), mkCalls(20, 0, 0))?.grade;
    expect(at(0.952)).toBe("A+"); // 95.2
    expect(at(0.882)).toBe("A"); // 88.2
    expect(at(0.812)).toBe("A-"); // 81.2
    expect(at(0.742)).toBe("B+"); // 74.2
    expect(at(0.672)).toBe("B"); // 67.2
    expect(at(0.602)).toBe("B-"); // 60.2
    expect(at(0.552)).toBe("C+"); // 55.2
    expect(at(0.452)).toBe("C"); // 45.2
    expect(at(0.402)).toBe("C-"); // 40.2
    expect(at(0.332)).toBe("D+"); // 33.2
    expect(at(0.262)).toBe("D"); // 26.2
    expect(at(0.192)).toBe("D-"); // 19.2
    expect(at(0.1)).toBe("F"); // <19
  });

  test("empty 3m horizon does not dilute excess (weighted pooling)", () => {
    // 20 calls at 1m (+10% excess), zero matured at 3m: excess must pool to 0.1, not 0.05.
    const sc = mkSc({
      hitRate: { "1m": 0.7, "3m": 0 },
      hitRateN: { "1m": 20, "3m": 0 },
      avgExcess: { "1w": 0, "1m": 0.1, "3m": 0, toDate: 0 },
    });
    const g = gradeFor(sc, mkCalls(20, 0.1, null));
    expect(g?.score).toBe(90); // 50 + 20 (hit) + 20 (excess), no dilution
    expect(g?.grade).toBe("A");
  });

  test("zero pooled sample returns null instead of NaN", () => {
    const sc = mkSc({ hitRateN: { "1m": 0, "3m": 0 } });
    expect(gradeFor(sc, mkCalls(20, 0, 0))).toBeNull();
  });
});

describe("persona labels", () => {
  // Helper: grade a synthetic creator and return the label.
  const label = (sc: Scorecard, calls: Call[]) => gradeFor(sc, calls)?.label;

  // --- A tier (hit 0.9, excess 0.1 -> score 50+40+20=100 unless overridden) ---
  const aSc = (over: Partial<Scorecard> = {}) =>
    mkSc({
      hitRate: { "1m": 0.9, "3m": 0.9 },
      avgExcess: { "1w": 0.02, "1m": 0.1, "3m": 0.1, toDate: 0 },
      ...over,
    });

  test("A + low volume -> The Sniper", () => {
    expect(label(aSc({ callsPerWeek: 0.3 }), mkCalls(20, 0.1, 0.1))).toBe("The Sniper");
  });
  test("A + excess-carried -> Ten-Bagger Hunter", () => {
    // hit 0.62 (+12), excess 0.2 (+40): excess carries.
    const sc = mkSc({
      hitRate: { "1m": 0.62, "3m": 0.62 },
      avgExcess: { "1w": 0.02, "1m": 0.2, "3m": 0.2, toDate: 0 },
    });
    expect(label(sc, mkCalls(20, 0.2, 0.2))).toBe("Ten-Bagger Hunter");
  });
  test("A + hit-carried -> Batting .700", () => {
    // hit 0.95 (+45), excess 0.03 (+6): hit carries. Score 101 -> clamp 100.
    const sc = mkSc({
      hitRate: { "1m": 0.95, "3m": 0.95 },
      avgExcess: { "1w": 0.02, "1m": 0.03, "3m": 0.03, toDate: 0 },
    });
    expect(label(sc, mkCalls(20, 0.03, 0.03))).toBe("Batting .700");
  });
  test("A balanced -> Money Printer", () => {
    // hit 0.72 (+22), excess 0.1 (+20): within margin, neither carries. Score 92 -> A.
    const sc = mkSc({
      hitRate: { "1m": 0.72, "3m": 0.72 },
      avgExcess: { "1w": 0.02, "1m": 0.1, "3m": 0.1, toDate: 0 },
    });
    expect(label(sc, mkCalls(20, 0.1, 0.1))).toBe("Money Printer");
  });
  test("rule order: A both lowVolume and excess-carried -> The Sniper wins", () => {
    const sc = mkSc({
      hitRate: { "1m": 0.62, "3m": 0.62 },
      avgExcess: { "1w": 0.02, "1m": 0.2, "3m": 0.2, toDate: 0 },
      callsPerWeek: 0.3,
    });
    expect(label(sc, mkCalls(20, 0.2, 0.2))).toBe("The Sniper");
  });

  // --- B tier (score 60-74) ---
  test("B + hit-carried -> Base Hit Merchant", () => {
    // hit 0.65 (+15), excess 0.02 (+4). Score 69 -> B.
    const sc = mkSc({
      hitRate: { "1m": 0.65, "3m": 0.65 },
      avgExcess: { "1w": 0.01, "1m": 0.02, "3m": 0.02, toDate: 0 },
    });
    expect(label(sc, mkCalls(20, 0.02, 0.02))).toBe("Base Hit Merchant");
  });
  test("B + high volume -> The Grinder", () => {
    // hit 0.55 (+5), excess 0.04 (+8): neither carries (margin 5). Score 63 -> B-.
    const sc = mkSc({
      hitRate: { "1m": 0.55, "3m": 0.55 },
      avgExcess: { "1w": 0.01, "1m": 0.04, "3m": 0.04, toDate: 0 },
      callsPerWeek: 3,
    });
    expect(label(sc, mkCalls(20, 0.04, 0.04))).toBe("The Grinder");
  });
  test("B + long record -> The Compounder", () => {
    const sc = mkSc({
      hitRate: { "1m": 0.55, "3m": 0.55 },
      hitRateN: { "1m": 45, "3m": 45 },
      avgExcess: { "1w": 0.01, "1m": 0.04, "3m": 0.04, toDate: 0 },
    });
    expect(label(sc, mkCalls(45, 0.04, 0.04))).toBe("The Compounder");
  });
  test("B default -> Positive Expectancy", () => {
    const sc = mkSc({
      hitRate: { "1m": 0.55, "3m": 0.55 },
      avgExcess: { "1w": 0.01, "1m": 0.04, "3m": 0.04, toDate: 0 },
    });
    expect(label(sc, mkCalls(20, 0.04, 0.04))).toBe("Positive Expectancy");
  });

  // --- C tier (score 45-55) ---
  test("C + zero excess + low dispersion -> SPY in a Trenchcoat", () => {
    // All 3m excess identical -> stdev 0.
    expect(label(mkSc({}), mkCalls(20, 0.001, 0.001))).toBe("SPY in a Trenchcoat");
  });
  test("C + high dispersion -> The Wash Trade", () => {
    // Half +30%, half -30% at 3m: mean ~0, stdev 0.3.
    const calls = [...mkCalls(10, 0, 0.3), ...mkCalls(10, 0, -0.3)];
    expect(label(mkSc({}), calls)).toBe("The Wash Trade");
  });
  test("C + high volume -> Noise Trader", () => {
    // Dispersion mid (stdev 0.1): half +10%, half -10%.
    const calls = [...mkCalls(10, 0, 0.1), ...mkCalls(10, 0, -0.1)];
    expect(
      label(
        mkSc({ callsPerWeek: 3, avgExcess: { "1w": 0, "1m": 0.02, "3m": 0, toDate: 0 } }),
        calls,
      ),
    ).toBe("Noise Trader");
  });
  test("C default -> Dartboard Monkey", () => {
    const calls = [...mkCalls(10, 0, 0.1), ...mkCalls(10, 0, -0.1)];
    expect(label(mkSc({ avgExcess: { "1w": 0, "1m": 0.02, "3m": 0, toDate: 0 } }), calls)).toBe(
      "Dartboard Monkey",
    );
  });

  // --- D tier (score 19-40) ---
  const dSc = (over: Partial<Scorecard> = {}) =>
    mkSc({
      hitRate: { "1m": 0.35, "3m": 0.35 },
      avgExcess: { "1w": -0.01, "1m": -0.03, "3m": -0.03, toDate: 0 },
      ...over,
    });
  test("D + bad 1w hit -> Exit Liquidity", () => {
    // All calls negative at 1w -> hit1w 0.
    expect(label(dSc(), mkCalls(20, -0.03, -0.03, -0.02))).toBe("Exit Liquidity");
  });
  test("D + 1w up but 3m ugly -> Dead Cat Bouncer", () => {
    const sc = dSc({ avgExcess: { "1w": 0.02, "1m": -0.03, "3m": -0.08, toDate: 0 } });
    expect(label(sc, mkCalls(20, -0.03, -0.08, 0.02))).toBe("Dead Cat Bouncer");
  });
  test("D + high volume -> FOMO Merchant", () => {
    expect(label(dSc({ callsPerWeek: 3 }), mkCalls(20, -0.03, -0.03, 0.01))).toBe("FOMO Merchant");
  });
  test("D default -> Knife Catcher", () => {
    expect(label(dSc(), mkCalls(20, -0.03, -0.03, 0.01))).toBe("Knife Catcher");
  });

  // --- F tier (score <19) ---
  const fSc = (over: Partial<Scorecard> = {}) =>
    mkSc({
      hitRate: { "1m": 0.35, "3m": 0.35 },
      avgExcess: { "1w": -0.02, "1m": -0.15, "3m": -0.15, toDate: 0 },
      ...over,
    });
  test("F + hit < 30% -> The Costanza", () => {
    const sc = fSc({ hitRate: { "1m": 0.25, "3m": 0.25 } });
    expect(label(sc, mkCalls(20, -0.15, -0.15, 0.01))).toBe("The Costanza");
  });
  test("F + high volume -> Reverse Midas", () => {
    expect(label(fSc({ callsPerWeek: 3 }), mkCalls(20, -0.15, -0.15, 0.01))).toBe("Reverse Midas");
  });
  test("F + catastrophic tail -> GUH", () => {
    const calls = [
      ...mkCalls(19, -0.15, -0.15, 0.01),
      mkCall({ e1m: -0.15, e3m: -0.5, e1w: 0.01 }),
    ];
    expect(label(fSc(), calls)).toBe("GUH");
  });
  test("F default -> Inverse Cramer", () => {
    expect(label(fSc(), mkCalls(20, -0.15, -0.15, 0.01))).toBe("Inverse Cramer");
  });
});
