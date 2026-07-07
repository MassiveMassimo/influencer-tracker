// Trait badges: independent boolean signals layered on top of the letter persona
// (see docs/superpowers/specs/2026-07-08-trait-badges-design.md). Each trait is a
// pure predicate over the creator's calls with its own N-guard — below the guard it
// never fires. Thresholds are tuned against the live roster (scripts/print-traits.ts)
// the same way K and the bands are in grade.ts.

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
