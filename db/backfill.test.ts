import { test, expect, beforeAll, describe } from "bun:test";
import { makeDb, type Db } from "./client";
import { backfillCreator } from "./backfill";
import { assertSeparateTestDb } from "./test-db";
import { creators, calls } from "./schema";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUN = !!process.env.DATABASE_URL_TEST;
const ROOT = join(import.meta.dir, "..");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
// Derive the fixture from the index so handle casing can never drift.
const index = RUN ? readJson(join(ROOT, "data", "creators", "index.json")) : [];
const indexEntry = index.find((e: { handle: string }) => /prof/i.test(e.handle)) ?? index[0];
const HANDLE = indexEntry?.handle;
const ds = RUN ? readJson(join(ROOT, "data", "creators", HANDLE, "dataset.json")) : null;

// Construct only when running — bun still evaluates a skipped describe body, so an eager
// makeDb(undefined) would throw "No database connection string".
const db = RUN ? makeDb(process.env.DATABASE_URL_TEST!) : (undefined as unknown as Db);

describe.skipIf(!RUN)("backfillCreator", () => {

  beforeAll(async () => {
    assertSeparateTestDb();
    await db.execute(sql`TRUNCATE creators, calls RESTART IDENTITY CASCADE`);
    await backfillCreator(db, indexEntry, ds, 0);
  });

  test("backfill inserts one creator row", async () => {
    const rows = await db.select().from(creators).where(eq(creators.handle, HANDLE));
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe(ds.creator.name);
  });

  test("backfill inserts every call", async () => {
    const rows = await db.select().from(calls).where(eq(calls.handle, HANDLE));
    expect(rows.length).toBe(ds.calls.length);
  });

  test("a call round-trips its returns jsonb", async () => {
    const sample = ds.calls[0];
    const rows = await db.select().from(calls).where(eq(calls.shortcode, sample.shortcode));
    expect(rows[0].returns).toEqual(sample.returns);
    expect(rows[0].ticker).toBe(sample.ticker);
  });
});
