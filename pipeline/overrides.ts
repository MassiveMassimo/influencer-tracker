import type { ReelCall, Direction } from "../src/lib/types";

// A single operator correction. Null fields mean "leave the classified value".
export interface Override {
  handle: string;
  shortcode: string;
  ticker: string | null;
  isExplicitBuy: boolean | null;
  direction: string | null;
  reason: string;
}

const DIRECTIONS = new Set<Direction>(["bullish", "bearish", "neutral"]);

// Deterministic final pass over the classified calls. Pure (no IO) so it is trivially
// testable; score() supplies the overrides loaded from the DB. Matching is by shortcode
// (the call PK within a creator). A field is applied only when non-null and valid, so a
// partial override (e.g. just a ticker fix) leaves everything else as classified.
export function applyOverrides(calls: ReelCall[], overrides: Override[]): ReelCall[] {
  if (overrides.length === 0) return calls;
  const byCode = new Map(overrides.map((o) => [o.shortcode, o]));
  return calls.map((c) => {
    const o = byCode.get(c.shortcode);
    if (!o) return c;
    const ticker = o.ticker && o.ticker.trim() ? o.ticker.trim().toUpperCase() : c.ticker;
    const isExplicitBuy = o.isExplicitBuy ?? c.isExplicitBuy;
    const direction = o.direction && DIRECTIONS.has(o.direction as Direction) ? (o.direction as Direction) : c.direction;
    return { ...c, ticker, isExplicitBuy, direction };
  });
}
