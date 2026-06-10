// Reads the committed static data and loads it into the DB pointed to by DATABASE_URL.
// Idempotent: creators/calls upsert; prices insert-only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { makeDb } from "../db/client";
import { calls } from "../db/schema";
import { backfillCreator, backfillPrices } from "../db/backfill";
import type { IndexEntry } from "../src/lib/dataset-source";

const ROOT = join(import.meta.dir, "..");
const CREATORS = join(ROOT, "data", "creators");
const PRICES = join(ROOT, "data", "prices");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

async function main() {
  const db = makeDb();
  const index: IndexEntry[] = readJson(join(CREATORS, "index.json"));
  for (const [ord, entry] of index.entries()) {
    const ds = readJson(join(CREATORS, entry.handle, "dataset.json"));
    await backfillCreator(db, entry, ds, ord);
    // Guard against the (handle, shortcode) PK silently merging rows if a post ever
    // yields two calls: inserted count must equal the source call count.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(eq(calls.handle, entry.handle));
    if (n !== ds.calls.length) throw new Error(`${entry.handle}: ${n} rows != ${ds.calls.length} calls`);
    console.log(`creator ${entry.handle}: ${ds.calls.length} calls`);
  }
  for (const file of readdirSync(PRICES).filter((f) => f.endsWith(".json"))) {
    const symbol = file.replace(/\.json$/, "");
    await backfillPrices(db, symbol, readJson(join(PRICES, file)));
  }
  console.log(`backfill done: ${index.length} creators.`);
}
main();
