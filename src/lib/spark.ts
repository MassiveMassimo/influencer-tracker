import type { OhlcBar } from "./types";

// Downsampled close-price series from `fromDate` forward, for a mini sparkline.
// Baked into each Call at score time so the dashboard needs no per-ticker OHLC.
// Always keeps the first and last point; evenly samples the middle.
// Values are rounded to 4 sig figs — a ~40px sparkline needs no more, and raw
// float64 closes (e.g. 608.9400024414062) were ~35% of the baked dataset bytes.
export function buildSpark(ohlc: OhlcBar[], fromDate: string, maxPoints = 24): number[] {
  const closes = ohlc.filter((b) => b.date >= fromDate).map((b) => b.c);
  if (closes.length <= maxPoints) return closes.map(round4);
  if (maxPoints <= 1) return closes.slice(0, 1).map(round4);
  const step = (closes.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => round4(closes[Math.round(i * step)]));
}

// 4 significant figures, decimal (Number round-trip keeps small/large values out
// of exponential notation for the price ranges we bake).
function round4(v: number): number {
  return Number(v.toPrecision(4));
}
