// One-off: read all data/prices/*.json into data/prices.db (SQLite).
// Run once after the prices-db code merges; then delete data/prices/*.json.
//
// Run: bun run scripts/migrate-prices-db.ts
import { readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { writePricesDb, closePricesDb, listSymbolsDb } from "../pipeline/prices-db";
import type { OhlcBar } from "../src/lib/types";

const PRICES_DIR = join(import.meta.dir, "..", "data", "prices");

if (!existsSync(PRICES_DIR)) {
  console.error("data/prices/ not found — nothing to migrate");
  process.exit(1);
}

const files = (await readdir(PRICES_DIR)).filter((f) => f.endsWith(".json"));
console.log(`migrating ${files.length} price files into data/prices.db`);

let totalBars = 0;
for (const f of files) {
  const symbol = f.replace(".json", "");
  const bars: OhlcBar[] = JSON.parse(await readFile(join(PRICES_DIR, f), "utf8"));
  const inserted = writePricesDb(symbol, bars);
  totalBars += bars.length;
  if (inserted !== bars.length)
    console.warn(
      `  ${symbol}: ${bars.length} bars, ${inserted} inserted (${bars.length - inserted} already present)`,
    );
}

const symbols = listSymbolsDb();
console.log(`done: ${symbols.length} symbols, ${totalBars} bars in data/prices.db`);
closePricesDb();

// Clean up the old loose JSON files — they're now in the DB.
console.log("removing data/prices/*.json (data is now in prices.db)");
await rm(PRICES_DIR, { recursive: true, force: true });
console.log("migration complete");
