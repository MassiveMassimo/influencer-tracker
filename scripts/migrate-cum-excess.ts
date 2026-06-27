// One-off: bake scorecard.cumExcess into committed datasets from the shared
// data/prices store, without a full re-score (which needs the gitignored per-creator
// state). score.ts now emits cumExcess directly; this back-fills existing datasets so
// the committed files + static fallback carry the curve. The DB picks it up on the
// next daily VM re-score (or db:sync). The logged endpoint should match
// avgExcess.toDate — a built-in correctness check.
//
// Run: bun run scripts/migrate-cum-excess.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCumExcess } from "../src/lib/cum-excess";
import type { OhlcBar } from "../src/lib/types";

const CREATORS = "data/creators";
const PRICES = "data/prices";

function loadPrices(sym: string): OhlcBar[] {
  const p = join(PRICES, `${sym}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : [];
}

const index: { handle: string }[] = JSON.parse(readFileSync(join(CREATORS, "index.json"), "utf8"));
const spy = loadPrices("SPY");
if (spy.length === 0)
  throw new Error("data/prices/SPY.json missing or empty — cannot bake cumExcess");

for (const { handle } of index) {
  const path = join(CREATORS, handle, "dataset.json");
  const ds = JSON.parse(readFileSync(path, "utf8"));
  // Clamp the shared store back to this dataset's score date. The store matures
  // forward daily (VM ingest), but the frozen scorecard stats were computed from
  // prices up to generatedAt — clamp so the curve shares that window and its
  // endpoint reconciles with avgExcess.toDate. A fresh score (score.ts) needs no
  // clamp: it fetches all symbols to the same day.
  const clamp = (ds.generatedAt as string).slice(0, 10);
  const trunc = (bars: OhlcBar[]) => bars.filter((b) => b.date <= clamp);
  const ohlc: Record<string, OhlcBar[]> = {};
  for (const sym of new Set<string>(ds.calls.map((c: { ticker: string }) => c.ticker))) {
    ohlc[sym] = trunc(loadPrices(sym));
  }
  const cum = buildCumExcess(ds.calls, ohlc, trunc(spy));
  ds.scorecard.cumExcess = cum;
  writeFileSync(path, JSON.stringify(ds, null, 2));
  const end = cum.length ? `${(cum.at(-1)!.v * 100).toFixed(2)}%` : "—";
  const ref = (ds.scorecard.avgExcess.toDate * 100).toFixed(2);
  console.log(`${handle}: ${cum.length} pts · endpoint ${end} (avgExcess.toDate ${ref}%)`);
}
