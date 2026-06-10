// Compares DB-reassembled output vs the committed static JSON for the DB at DATABASE_URL.
// Run AFTER `bun run db:backfill` against the target (prod) DB, before flipping USE_DB=1.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeDb } from "../db/client";
import { readDataset, readIndex, readPrices } from "../src/lib/db-read";

const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// Canonical JSON: object keys sorted recursively so key-order differences don't false-fail.
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function main() {
  const db = makeDb();
  const index = readJson(join(ROOT, "data", "creators", "index.json"));
  if (!eq(index, await readIndex(db))) throw new Error("index parity FAILED");
  for (const e of index) {
    const stat = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
    if (!eq(stat, await readDataset(db, e.handle))) throw new Error(`dataset parity FAILED for ${e.handle}`);
    console.log(`✓ ${e.handle}`);
  }
  // Prices are the frozen-scoring source of truth — verify every per-symbol OHLC file
  // reassembles byte-identical from the DB, not just creators/calls.
  const priceFiles = readdirSync(join(ROOT, "data", "prices")).filter((f) => f.endsWith(".json"));
  for (const f of priceFiles) {
    const symbol = f.replace(/\.json$/, "");
    const stat = readJson(join(ROOT, "data", "prices", f));
    if (!eq(stat, await readPrices(db, symbol))) throw new Error(`prices parity FAILED for ${symbol}`);
  }
  console.log(`✓ ${priceFiles.length} price symbols`);
  console.log("PARITY OK — safe to flip USE_DB=1");
}
main();
