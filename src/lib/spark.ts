import type { OhlcBar } from "./types";

// Downsampled close-price series from `fromDate` forward, for a mini sparkline.
// Baked into each Call at score time so the dashboard needs no per-ticker OHLC.
// Always keeps the first and last point; evenly samples the middle.
export function buildSpark(ohlc: OhlcBar[], fromDate: string, maxPoints = 24): number[] {
  const closes = ohlc.filter((b) => b.date >= fromDate).map((b) => b.c);
  if (closes.length <= maxPoints) return closes;
  const step = (closes.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => closes[Math.round(i * step)]);
}
