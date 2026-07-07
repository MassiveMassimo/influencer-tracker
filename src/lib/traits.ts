// Trait badges: independent boolean signals layered on top of the letter persona
// (see docs/superpowers/specs/2026-07-08-trait-badges-design.md). Each trait is a
// pure predicate over the creator's calls with its own N-guard — below the guard it
// never fires. Thresholds are tuned against the live roster (scripts/print-traits.ts)
// the same way K and the bands are in grade.ts.

import type { Call } from "./types";

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// Population stdev (matches the population moments skewness uses).
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Fisher-Pearson g1 with population moments; 0 when undefined (n < 3, zero variance).
export function skewness(xs: number[]): number {
  if (xs.length < 3) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  return mean(xs.map((x) => ((x - m) / s) ** 3));
}

// Pearson correlation; 0 when undefined (n < 2, zero variance in either series).
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

// Thresholds (tuned with the roster; see spec).
const CRYPTO_SHARE = 0.6;
const CRYPTO_MIN_N = 10;
const LOTTERY_MIN_N = 20;
const LOTTERY_SKEW = 1;
const REGIME_MIN_N = 8; // scored calls required in EACH SPY regime
const REGIME_GAP = 0.3; // hit(SPY-up) - hit(SPY-down)
const TRAJECTORY_MIN_N = 30;
const TRAJECTORY_DELTA = 0.08; // mean 3m excess, second half minus first
const CALIBRATION_MIN_N = 30;
const CALIBRATION_R = 0.3;
const CONVICTION_MIN_SD = 0.05; // conviction must actually vary

export interface Trait {
  id: string;
  name: string;
  blurb: string; // one playful line, PERSONA_BLURB voice
  hue: "orange" | "violet" | "amber" | "emerald" | "rose" | "teal" | "fuchsia";
  shape: "hexagon" | "ticket" | "shield" | "star" | "rosette";
  icon: string; // iconify tailwind class, e.g. "icon-[mdi--fire]"
}

interface TraitCtx {
  first: Call[]; // isFirstCall, postDate ascending
  ex3: number[]; // non-null 3m excess of first calls, postDate order
}

interface TraitDef extends Trait {
  test(ctx: TraitCtx): boolean;
}

// Pearson r of (conviction, 3m excess); 0 = "no signal" (guards included).
function calibrationR(first: Call[]): number {
  const scored = first.filter((c) => c.returns["3m"].excess != null);
  if (scored.length < CALIBRATION_MIN_N) return 0;
  const conv = scored.map((c) => c.conviction);
  if (stdev(conv) <= CONVICTION_MIN_SD) return 0;
  return pearson(
    conv,
    scored.map((c) => c.returns["3m"].excess as number),
  );
}

// hit(SPY-up) - hit(SPY-down) with the down-regime hit rate, or null below guard.
function regimeSplit(first: Call[]): { gap: number; downHit: number } | null {
  const up: boolean[] = [];
  const down: boolean[] = [];
  for (const c of first) {
    const ex = c.returns["3m"].excess;
    const spy = c.returns["3m"].spy;
    if (ex == null || spy == null || spy === 0) continue;
    (spy > 0 ? up : down).push(ex > 0);
  }
  if (up.length < REGIME_MIN_N || down.length < REGIME_MIN_N) return null;
  const hit = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;
  return { gap: hit(up) - hit(down), downHit: hit(down) };
}

// Mean 3m excess of the second half of the record minus the first; 0 below guard.
function trajectoryDelta(ex3: number[]): number {
  if (ex3.length < TRAJECTORY_MIN_N) return 0;
  const half = Math.floor(ex3.length / 2);
  return mean(ex3.slice(half)) - mean(ex3.slice(0, half));
}

// Array order IS the display priority (most informative first).
const TRAITS: TraitDef[] = [
  {
    id: "calibrated",
    name: "Calibrated",
    blurb: "When they say high conviction, believe it — confidence tracks results.",
    hue: "teal",
    shape: "rosette",
    icon: "icon-[mdi--bullseye-arrow]",
    test: ({ first }) => calibrationR(first) >= CALIBRATION_R,
  },
  {
    id: "confidently-wrong",
    name: "Confidently Wrong",
    blurb: "The louder the conviction, the worse the call. Fade the pounding table.",
    hue: "fuchsia",
    shape: "rosette",
    icon: "icon-[mdi--compass-off]",
    test: ({ first }) => calibrationR(first) <= -CALIBRATION_R,
  },
  {
    id: "bull-only",
    name: "Bull Market Only",
    blurb: "Great when SPY's green. When it's red, so are the calls.",
    hue: "amber",
    shape: "shield",
    icon: "icon-[game-icons--bull-horns]",
    test: ({ first }) => {
      const r = regimeSplit(first);
      return r != null && r.gap >= REGIME_GAP && r.downHit < 0.5;
    },
  },
  {
    id: "rising-star",
    name: "Rising Star",
    blurb: "The recent record is way better than the early one. Improving.",
    hue: "emerald",
    shape: "star",
    icon: "icon-[mdi--arrow-up-bold]",
    test: ({ ex3 }) => trajectoryDelta(ex3) >= TRAJECTORY_DELTA,
  },
  {
    id: "fallen-star",
    name: "Fallen Star",
    blurb: "Used to be sharp. The recent calls don't keep up.",
    hue: "rose",
    shape: "star",
    icon: "icon-[mdi--arrow-down-bold]",
    test: ({ ex3 }) => trajectoryDelta(ex3) <= -TRAJECTORY_DELTA,
  },
  {
    id: "lottery-ticket",
    name: "Lottery Ticket",
    blurb: "Most calls fizzle; the occasional moonshot pays for the rest.",
    hue: "violet",
    shape: "ticket",
    icon: "icon-[mdi--dice-multiple]",
    test: ({ ex3 }) =>
      ex3.length >= LOTTERY_MIN_N && skewness(ex3) > LOTTERY_SKEW && median(ex3) < 0,
  },
  {
    id: "laser-eyes",
    name: "Laser Eyes",
    blurb: "Portfolio's mostly crypto. Number-go-up technology.",
    hue: "orange",
    shape: "hexagon",
    icon: "icon-[mdi--fire]",
    test: ({ first }) =>
      first.length >= CRYPTO_MIN_N &&
      first.filter((c) => c.ticker.endsWith("-USD")).length / first.length > CRYPTO_SHARE,
  },
];

// Earned traits, in display-priority order. Pure; never mutates `calls`.
export function traitsFor(calls: Call[]): Trait[] {
  const byDate = [...calls].sort((a, b) => a.postDate.localeCompare(b.postDate));
  const first = byDate.filter((c) => c.isFirstCall);
  const ex3 = first.map((c) => c.returns["3m"].excess).filter((x): x is number => x != null);
  const ctx: TraitCtx = { first, ex3 };
  return TRAITS.filter((t) => t.test(ctx)).map(({ test: _test, ...meta }) => meta);
}
