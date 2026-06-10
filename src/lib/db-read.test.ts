import { test, expect, beforeAll, describe } from "bun:test";
import { makeDb, type Db } from "../../db/client";
import { backfillCreator, backfillPrices } from "../../db/backfill";
import { sql } from "drizzle-orm";
import { readDataset, readIndex, readPrices, readCallsIndex } from "./db-read";
import { buildCallsIndex } from "./call-index";
import { artifacts } from "../../db/schema";
import { DatasetSchema } from "./schema";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RUN = !!process.env.DATABASE_URL_TEST;
const ROOT = join(import.meta.dir, "..", "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const index = RUN ? readJson(join(ROOT, "data", "creators", "index.json")) : [];

// Construct only when running — bun still evaluates a skipped describe body.
const db = RUN ? makeDb(process.env.DATABASE_URL_TEST!) : (undefined as unknown as Db);

describe.skipIf(!RUN)("DB read golden master", () => {

  beforeAll(async () => {
    await db.execute(sql`TRUNCATE creators, calls, prices, artifacts RESTART IDENTITY CASCADE`);
    for (const [ord, e] of index.entries()) {
      await backfillCreator(db, e, readJson(join(ROOT, "data", "creators", (e as { handle: string }).handle, "dataset.json")), ord as number);
    }
    for (const f of readdirSync(join(ROOT, "data", "prices")).filter((f) => f.endsWith(".json"))) {
      await backfillPrices(db, f.replace(/\.json$/, ""), readJson(join(ROOT, "data", "prices", f)));
    }
  });

  test("readDataset deep-equals the static dataset.json (incl. call order)", async () => {
    for (const e of index) {
      const stat = readJson(join(ROOT, "data", "creators", e.handle, "dataset.json"));
      const fromDb = await readDataset(db, e.handle);
      // Schema-shaped deep-equal; array order IS asserted, proving `ord` reconstructs file order.
      expect(DatasetSchema.parse(fromDb)).toEqual(DatasetSchema.parse(stat));
    }
  });

  test("readIndex equals index.json in order", async () => {
    const fromDb = await readIndex(db);
    expect(fromDb).toEqual(index);
  });

  test("readPrices deep-equals the static price file", async () => {
    const symbol = "SPY";
    const stat = readJson(join(ROOT, "data", "prices", `${symbol}.json`));
    const fromDb = await readPrices(db, symbol);
    expect(fromDb).toEqual(stat);
  });

  test("readCallsIndex deep-equals buildCallsIndex over all datasets", async () => {
    const datasets = await Promise.all(index.map((e: { handle: string }) => readDataset(db, e.handle)));
    const expected = buildCallsIndex(datasets);
    await db.insert(artifacts)
      .values({ key: "calls-index", payload: expected, generatedAt: "2026-06-10" })
      .onConflictDoUpdate({ target: artifacts.key, set: { payload: expected, generatedAt: "2026-06-10" } });
    const fromDb = await readCallsIndex(db);
    expect(fromDb).toEqual(expected);
  });
});
