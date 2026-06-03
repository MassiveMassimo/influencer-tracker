// scripts/migrate-split-prices.ts
// One-time: restructure existing committed dataset.json files into the slim shape
// (drop `tickers`, bake `spark` per call) and write the shared deduped price store.
// Reads the OLD fat dataset via raw JSON.parse (not the new schema), so it is
// unaffected by the schema change. Idempotent: safe to re-run.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildSpark } from "../src/lib/spark";
import { mergePrices } from "../src/lib/prices-merge";
import type { OhlcBar } from "../src/lib/types";

const DATA = join(import.meta.dir, "..", "data", "creators");
const SHARED = join(import.meta.dir, "..", "data", "prices");
mkdirSync(SHARED, { recursive: true });

const index: { handle: string }[] = JSON.parse(readFileSync(join(DATA, "index.json"), "utf8"));
for (const e of index) {
  const p = join(DATA, e.handle, "dataset.json");
  const ds = JSON.parse(readFileSync(p, "utf8"));
  const tickers: Record<string, { ohlc: OhlcBar[] }> = ds.tickers ?? {};

  for (const c of ds.calls) {
    c.spark = buildSpark(tickers[c.ticker]?.ohlc ?? [], c.postDate);
  }
  for (const [sym, t] of Object.entries(tickers)) {
    const f = join(SHARED, `${sym}.json`);
    const existing: OhlcBar[] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
    writeFileSync(f, JSON.stringify(mergePrices(existing, t.ohlc)));
  }
  delete ds.tickers;
  writeFileSync(p, JSON.stringify(ds, null, 2));
  console.log(`migrated ${e.handle}: ${ds.calls.length} calls, ${Object.keys(tickers).length} tickers`);
}
