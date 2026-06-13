// Reads the committed static data and loads it into the DB. Runs as the ingest writer
// (DATABASE_URL_INGEST), not the owner or the SELECT-only serve role (Plan 1 review finding 3).
// Idempotent: creators/calls upsert; prices insert-only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { getWriteDb } from "../db/client";
import { calls } from "../db/schema";
import { backfillCreator, backfillPrices } from "../db/backfill";
import type { IndexEntry } from "../src/lib/dataset-source";

const ROOT = join(import.meta.dir, "..");
const CREATORS = join(ROOT, "data", "creators");
const PRICES = join(ROOT, "data", "prices");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const db = getWriteDb();
  const index: IndexEntry[] = readJson(join(CREATORS, "index.json"));
  const scopedHandle = process.argv[2];

  if (scopedHandle) {
    // Scoped mode: backfill only the single reviewed creator. A global sync would upsert
    // other creators' daily-reset stale static over their live DB rows and trip the guard.
    console.log(`scoped backfill: ${scopedHandle}`);
    const ord = index.findIndex((e) => e.handle === scopedHandle);
    if (ord === -1) throw new Error(`handle ${scopedHandle} not found in index.json`);
    const entry = index[ord];
    const ds = readJson(join(CREATORS, scopedHandle, "dataset.json"));
    await backfillCreator(db, entry, ds, ord);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(eq(calls.handle, scopedHandle));
    if (n !== ds.calls.length) throw new Error(`${scopedHandle}: ${n} rows != ${ds.calls.length} calls — a removed call needs owner-role DELETE on calls (ingest cannot); see Plan 3b deletion policy.`);
    console.log(`creator ${scopedHandle}: ${ds.calls.length} calls`);
    // Backfill only this creator's price symbols (insert-only; no cross-creator regression).
    const symbols = [...new Set([...ds.calls.map((c: { ticker: string }) => c.ticker), "SPY"])];
    for (const sym of symbols) {
      const priceFile = join(PRICES, `${sym}.json`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let prices: any;
      try {
        prices = readJson(priceFile);
      } catch {
        // Skip symbols whose price file is absent (e.g. an unscored or unrecognised ticker).
        continue;
      }
      await backfillPrices(db, sym, prices);
    }
    console.log(`backfill done (scoped): ${scopedHandle}.`);
    return;
  }

  // Global mode (cutover path): loop all creators then all price files — unchanged.
  for (const [ord, entry] of index.entries()) {
    const ds = readJson(join(CREATORS, entry.handle, "dataset.json"));
    await backfillCreator(db, entry, ds, ord);
    // Guard against the (handle, shortcode) PK silently merging rows if a post ever
    // yields two calls: inserted count must equal the source call count.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(eq(calls.handle, entry.handle));
    if (n !== ds.calls.length) throw new Error(`${entry.handle}: ${n} rows != ${ds.calls.length} calls — a removed call needs owner-role DELETE on calls (ingest cannot); see Plan 3b deletion policy.`);
    console.log(`creator ${entry.handle}: ${ds.calls.length} calls`);
  }
  for (const file of readdirSync(PRICES).filter((f) => f.endsWith(".json"))) {
    const symbol = file.replace(/\.json$/, "");
    await backfillPrices(db, symbol, readJson(join(PRICES, file)));
  }
  console.log(`backfill done: ${index.length} creators.`);
}
main();
