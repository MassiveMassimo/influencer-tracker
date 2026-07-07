import type { Call, Scorecard } from "./types";
import { LOW_CONFIDENCE_N } from "./scorecard";

// Composite grade: consistency (pooled 1m+3m hit rate vs SPY) + magnitude (sample-
// weighted pooled 1m/3m avg excess, clamped). Absolute scale anchored so hit 50% +
// excess 0 = 50 = C.
// Constants tuned once against the real roster (see design spec); K=2 means 5% avg
// excess moves the score 10 points.
const K = 2;
const EXCESS_CAP = 0.25;

// Persona signal thresholds (tuned with the roster like K and the bands).
const HIGH_VOLUME = 2; // calls/week
const LOW_VOLUME = 0.5;
const CARRY_MARGIN = 5; // score points one component must lead by
const LONG_RECORD = 40; // scored calls
const DISPERSION_HIGH = 0.15; // stdev of per-call 3m excess
const DISPERSION_LOW = 0.05;
const TIGHT_EXCESS = 0.01; // |pooledExcess| below this ~= indexing
const BAD_1W_HIT = 0.35;
const DEAD_CAT_3M = -0.05;
const COSTANZA_HIT = 0.3;
const CATASTROPHIC = -0.4; // any single 3m excess at or below this

export interface Grade {
  grade: string; // "A+" ... "F"
  letter: "A" | "B" | "C" | "D" | "F";
  label: string; // persona, filled by personaFor
  score: number; // 0-100 composite
  // Score components, exposed so the UI explains the math instead of recomputing.
  detail: {
    pooledHit: number; // 0-1
    pooledExcess: number; // fraction (e.g. 0.021 = +2.1%)
    hitPoints: number; // signed points contributed by hit rate
    excessPoints: number; // signed points contributed by avg excess
    scoredN: number;
  };
}

// One-line meaning per letter — the plain-english "what this grade means".
export const LETTER_MEANING: Record<Grade["letter"], string> = {
  A: "Consistently beats the market — a genuine edge.",
  B: "Beats the market more often than not — a modest but real edge.",
  C: "Roughly matches the market — similar to just holding SPY.",
  D: "Trails the market — calls lose to SPY more often than they win.",
  F: "Consistently trails the market, often by a lot.",
};

// Playful one-liner per persona (keys match personaFor's return strings exactly).
export const PERSONA_BLURB: Record<string, string> = {
  "The Sniper": "Rarely shoots, rarely misses. Every call counts.",
  "Ten-Bagger Hunter": "Swings for the fences and connects — the wins are enormous.",
  "Batting .700": "Not always huge, but right far more often than not.",
  "Money Printer": "Consistently right, consistently ahead of the market. Brrr.",
  "Base Hit Merchant": "Singles and doubles, rarely strikes out. Reliable, not flashy.",
  "The Grinder": "Posts constantly and stays ahead of SPY through sheer volume.",
  "The Compounder": "A long track record of quietly beating the market.",
  "Positive Expectancy": "The edge is real — over time it tilts in your favor.",
  "SPY in a Trenchcoat": "You could just buy the index and get the same thing.",
  "The Wash Trade": "Big swings that cancel out — some moon, some crater, nets to ~nothing.",
  "Noise Trader": "Lots of calls, no signal. The volume adds heat, not light.",
  "Dartboard Monkey": "About as accurate as throwing darts. Roughly a coin flip.",
  "Exit Liquidity": "Calls tend to top out right after — someone's got to sell to.",
  "Dead Cat Bouncer": "An early pop, then it rolls over. The bounce doesn't hold.",
  "FOMO Merchant": "Chases whatever's hot, usually right as it peaks.",
  "Knife Catcher": "Keeps buying the dip that keeps dipping.",
  "The Costanza": "Do the opposite of every instinct and you'd be rich.",
  "Reverse Midas": "Everything touched turns to loss. Prolifically.",
  GUH: "Called the top, bought the top, became the top.",
  "Inverse Cramer": "Fade every call and print money.",
};

const BANDS: [number, string][] = [
  [95, "A+"],
  [88, "A"],
  [81, "A-"],
  [74, "B+"],
  [67, "B"],
  [60, "B-"],
  [55, "C+"],
  [45, "C"],
  [40, "C-"],
  [33, "D+"],
  [26, "D"],
  [19, "D-"],
  [-Infinity, "F"],
];

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

interface PersonaCtx {
  sc: Scorecard;
  first: Call[];
  scoredN: number;
  pooledHit: number;
  pooledExcess: number;
  hitComp: number;
  excessComp: number;
}

function personaFor(letter: Grade["letter"], ctx: PersonaCtx): string {
  const { sc, first, scoredN, pooledHit, pooledExcess, hitComp, excessComp } = ctx;
  const ex3 = first.map((c) => c.returns["3m"].excess).filter((x): x is number => x != null);
  const ex1w = first.map((c) => c.returns["1w"].excess).filter((x): x is number => x != null);
  const dispersion = stdev(ex3);
  const hit1w = ex1w.length ? ex1w.filter((x) => x > 0).length / ex1w.length : 0.5;
  const highVolume = sc.callsPerWeek >= HIGH_VOLUME;
  const lowVolume = sc.callsPerWeek <= LOW_VOLUME;
  const hitCarried = hitComp >= excessComp + CARRY_MARGIN;
  const excessCarried = excessComp >= hitComp + CARRY_MARGIN;

  switch (letter) {
    case "A":
      if (lowVolume) return "The Sniper";
      if (excessCarried) return "Ten-Bagger Hunter";
      if (hitCarried) return "Batting .700";
      return "Money Printer";
    case "B":
      if (hitCarried) return "Base Hit Merchant";
      if (highVolume) return "The Grinder";
      if (scoredN >= LONG_RECORD) return "The Compounder";
      return "Positive Expectancy";
    case "C":
      if (Math.abs(pooledExcess) < TIGHT_EXCESS && dispersion <= DISPERSION_LOW)
        return "SPY in a Trenchcoat";
      if (dispersion >= DISPERSION_HIGH) return "The Wash Trade";
      if (highVolume) return "Noise Trader";
      return "Dartboard Monkey";
    case "D":
      if (hit1w < BAD_1W_HIT) return "Exit Liquidity";
      if (sc.avgExcess["1w"] > 0 && sc.avgExcess["3m"] < DEAD_CAT_3M) return "Dead Cat Bouncer";
      if (highVolume) return "FOMO Merchant";
      return "Knife Catcher";
    case "F":
      if (pooledHit < COSTANZA_HIT) return "The Costanza";
      if (highVolume) return "Reverse Midas";
      if (ex3.some((x) => x <= CATASTROPHIC)) return "GUH";
      return "Inverse Cramer";
  }
}

export function gradeFor(sc: Scorecard, calls: Call[]): Grade | null {
  const first = calls.filter((c) => c.isFirstCall);
  const scored = first.filter(
    (c) => c.returns["1m"].excess != null || c.returns["3m"].excess != null,
  );
  if (scored.length < LOW_CONFIDENCE_N) return null;

  const n1 = sc.hitRateN["1m"];
  const n3 = sc.hitRateN["3m"];
  if (n1 + n3 === 0) return null;
  const pooledHit = (sc.hitRate["1m"] * n1 + sc.hitRate["3m"] * n3) / (n1 + n3);
  const pooledExcess = (sc.avgExcess["1m"] * n1 + sc.avgExcess["3m"] * n3) / (n1 + n3);
  const hitComp = (pooledHit - 0.5) * 100;
  const excessComp = K * clamp(pooledExcess, -EXCESS_CAP, EXCESS_CAP) * 100;
  const score = clamp(50 + hitComp + excessComp, 0, 100);
  const grade = BANDS.find(([min]) => score >= min)![1];
  const letter = grade[0] as Grade["letter"];
  const label = personaFor(letter, {
    sc,
    first,
    scoredN: scored.length,
    pooledHit,
    pooledExcess,
    hitComp,
    excessComp,
  });
  return {
    grade,
    letter,
    label,
    score,
    detail: {
      pooledHit,
      pooledExcess,
      hitPoints: hitComp,
      excessPoints: excessComp,
      scoredN: scored.length,
    },
  };
}
