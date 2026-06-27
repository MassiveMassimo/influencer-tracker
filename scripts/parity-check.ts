// Compares DB-reassembled output vs the committed static JSON for the DB at DATABASE_URL.
// Run AFTER `bun run db:sync` against the target (prod) DB, before flipping USE_DB=1.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../db/client";
import { readCallsIndex, readDataset, readIndex, readPrices } from "../src/lib/db-read";
import { buildCallsIndex } from "../src/lib/call-index";

const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// Canonical JSON: object keys sorted recursively so key-order differences don't false-fail.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function main() {
  // Verify the EXACT connection prod will serve from (getDb → DATABASE_URL_SERVE), not the
  // owner — so a wrong-branch serve URL or a missing serve GRANT is caught here, before the
  // USE_DB=1 flip, rather than silently degrading every SSR render to static at runtime.
  const db = makeDb(process.env.DATABASE_URL_SERVE ?? process.env.DATABASE_URL);
  const scopedHandle = process.argv[2];

  if (scopedHandle) {
    // Scoped mode: verify only the reviewed creator's dataset. The global index / all-datasets
    // / all-prices / artifact checks false-fail on the VM's lagging committed static (prior
    // days' scored data is live in the DB but never committed back). Prices are insert-only so
    // they can't regress; a dataset match validates price-derived returns/spark/scorecard.
    const stat = readJson(join(ROOT, "data", "creators", scopedHandle, "dataset.json"));
    const dbDataset = await readDataset(db, scopedHandle);
    if (!eq(stat, dbDataset)) throw new Error(`dataset parity FAILED for ${scopedHandle}`);
    console.log(`✓ ${scopedHandle}`);
    console.log(`PARITY OK (scoped: ${scopedHandle})`);
    return;
  }

  // Global mode (cutover path): full index + all datasets + all prices + artifact — unchanged.
  const index = readJson(join(ROOT, "data", "creators", "index.json"));
  if (index.length === 0) throw new Error("index.json empty — refusing to certify parity");
  if (!eq(index, await readIndex(db))) throw new Error("index parity FAILED");
  // Accumulate the DB datasets here so the calls-index artifact check below reuses them
  // rather than re-fetching every creator — one Neon round-trip per creator, not two.
  const datasets = [];
  for (const e of index) {
    const stat = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
    const dbDataset = await readDataset(db, e.handle);
    if (!eq(stat, dbDataset)) throw new Error(`dataset parity FAILED for ${e.handle}`);
    datasets.push(dbDataset);
    console.log(`✓ ${e.handle}`);
  }
  // Prices are the frozen-scoring source of truth — verify every per-symbol OHLC file
  // reassembles byte-identical from the DB, not just creators/calls.
  const priceFiles = readdirSync(join(ROOT, "data", "prices")).filter((f) => f.endsWith(".json"));
  if (priceFiles.length === 0) throw new Error("no price files found — refusing to certify parity");
  for (const f of priceFiles) {
    const symbol = f.replace(/\.json$/, "");
    const stat = readJson(join(ROOT, "data", "prices", f));
    if (!eq(stat, await readPrices(db, symbol)))
      throw new Error(`prices parity FAILED for ${symbol}`);
  }
  console.log(`✓ ${priceFiles.length} price symbols`);
  // Reassemble the calls-index from the DB datasets gathered above and assert it equals the
  // materialized artifact — catches a stale/drifted artifact left by a backfill without a
  // re-materialize (review M2). Uses the same readers/builder the serve path uses.
  if (!eq(buildCallsIndex(datasets), await readCallsIndex(db))) {
    throw new Error("calls-index artifact parity FAILED — re-run `bun run db:materialize`");
  }
  console.log("✓ calls-index artifact");
  console.log("PARITY OK — safe to flip USE_DB=1");
}
main();
