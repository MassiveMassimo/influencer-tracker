// Recompute serve artifacts from the DB ledger and upsert them into the `artifacts`
// table. Run after backfill/score (and, in Plan 3, at the end of each ingest run).
// Idempotent: upserts by key. Requires DATABASE_URL.
import { getDb } from "../db/client";
import { readIndex, readDataset } from "../src/lib/db-read";
import { buildCallsIndex } from "../src/lib/call-index";
import { artifacts } from "../db/schema";

async function main() {
  const db = getDb();
  const index = await readIndex(db);
  const datasets = await Promise.all(index.map((e) => readDataset(db, e.handle)));
  const callsIndex = buildCallsIndex(datasets);
  const generatedAt = new Date().toISOString().slice(0, 10);
  await db
    .insert(artifacts)
    .values({ key: "calls-index", payload: callsIndex, generatedAt })
    .onConflictDoUpdate({ target: artifacts.key, set: { payload: callsIndex, generatedAt } });
  console.log(`materialized calls-index: ${callsIndex.length} calls across ${index.length} creators`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
