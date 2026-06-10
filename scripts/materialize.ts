// Recompute serve artifacts from the DB ledger and upsert them into the `artifacts`
// table. Run after backfill/score (and, in Plan 3, at the end of each ingest run).
// Idempotent: upserts by key. Writes the artifacts table, so it runs as the ingest
// writer (DATABASE_URL_INGEST), not the SELECT-only serve role.
import { getWriteDb } from "../db/client";
import { readIndex, readDataset } from "../src/lib/db-read";
import { buildCallsIndex } from "../src/lib/call-index";
import { artifacts } from "../db/schema";

async function main() {
  const db = getWriteDb();
  const index = await readIndex(db);
  const datasets = await Promise.all(index.map((e) => readDataset(db, e.handle)));
  const callsIndex = buildCallsIndex(datasets);
  // Never clobber a good artifact with an empty one — an empty index means the DB is
  // un-backfilled or an ingest run failed before reaching here, not "zero calls".
  if (callsIndex.length === 0) {
    throw new Error("refusing to materialize an empty calls-index (DB un-backfilled or mid-ingest?)");
  }
  const generatedAt = new Date().toISOString();
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
