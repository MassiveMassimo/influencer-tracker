import type { ReelCall, Direction } from "../src/lib/types";
import { resolveSymbol } from "../src/lib/symbol";

// A single operator correction. Null fields mean "leave the classified value".
export interface Override {
  handle: string;
  shortcode: string;
  // Which call within the post this targets, matched against the classified ticker
  // (raw or canonical). "" = legacy/whole-post: applies to every call in the post
  // (the pre-multi-stock shape, when a post had exactly one call).
  targetTicker: string;
  ticker: string | null;
  isExplicitBuy: boolean | null;
  direction: string | null;
  reason: string;
}

const DIRECTIONS = new Set<Direction>(["bullish", "bearish", "neutral"]);

// Does override `o` target call `c`? A post can name multiple stocks, so a bare
// shortcode is not enough; targetTicker disambiguates. Match the classified ticker
// either raw (case-insensitive) or by canonical symbol (so an operator can target
// "BTC" and hit a call classified as "BTCUSD"). "" targets every call in the post.
function targets(o: Override, c: ReelCall): boolean {
  if (o.shortcode !== c.shortcode) return false;
  if (o.targetTicker === "") return true;
  const t = o.targetTicker.trim().toUpperCase();
  const ct = c.ticker.trim().toUpperCase();
  if (t === ct) return true;
  return resolveSymbol(t) !== null && resolveSymbol(t) === resolveSymbol(ct);
}

// Deterministic final pass over the classified calls. Pure (no IO — resolveSymbol is a
// synchronous lookup) so it stays trivially testable; score() supplies the overrides
// loaded from the DB. A field is applied only when non-null and valid, so a partial
// override (e.g. just a ticker fix) leaves everything else as classified. When several
// overrides match a call, a ticker-specific one wins over a legacy whole-post ("") one.
export function applyOverrides(calls: ReelCall[], overrides: Override[]): ReelCall[] {
  if (overrides.length === 0) return calls;
  return calls.map((c) => {
    const matching = overrides.filter((o) => targets(o, c));
    if (matching.length === 0) return c;
    // Prefer a specific (non-empty targetTicker) override over a legacy whole-post one.
    const o = matching.find((m) => m.targetTicker !== "") ?? matching[0]!;
    const ticker = o.ticker && o.ticker.trim() ? o.ticker.trim().toUpperCase() : c.ticker;
    const isExplicitBuy = o.isExplicitBuy ?? c.isExplicitBuy;
    const direction = o.direction && DIRECTIONS.has(o.direction as Direction) ? (o.direction as Direction) : c.direction;
    return { ...c, ticker, isExplicitBuy, direction };
  });
}
