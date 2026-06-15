import { test, expect, describe, beforeAll } from "bun:test";
import { makeDb, type Db } from "./client";
import { calls, creators } from "./schema";
import { assertSeparateTestDb } from "./test-db";
import { insertReport, reportQueue } from "./reports";
import { REPORT_REASONS } from "../src/lib/report-reasons";
import { sql } from "drizzle-orm";

const RUN = !!process.env.DATABASE_URL_INGEST_TEST;

// Construct only when running — bun still evaluates a skipped describe body, so an eager
// makeDb(undefined) would throw "No database connection string".
const db = RUN ? makeDb(process.env.DATABASE_URL_INGEST_TEST!) : (undefined as unknown as Db);

describe.skipIf(!RUN)("reports", () => {
  beforeAll(async () => {
    assertSeparateTestDb();
    // TRUNCATE in FK-safe order (call_reports → calls → creators).
    await db.execute(sql`TRUNCATE call_reports, calls, creators RESTART IDENTITY CASCADE`);
    await db.insert(creators).values({
      handle: "h",
      name: "n",
      ord: 0,
      generatedAt: "2026-06-01",
      spyAnchor: "2026-01-01",
      scorecard: {},
      caveats: [],
      indexStats: {},
    }).onConflictDoNothing();
    await db.insert(calls).values({
      handle: "h",
      shortcode: "AAA",
      ord: 0,
      postDate: "2026-06-01",
      ticker: "AAPL",
      company: "Apple",
      isFirstCall: false,
      conviction: 0.8,
      quote: "Going up",
      returns: {},
    }).onConflictDoNothing();
  });

  test("insertReport dedupes by (handle, shortcode, ticker, reporterHash); queue counts compound", async () => {
    await insertReport(db, { handle: "h", shortcode: "AAA", ticker: "AAPL", reason: "wrong-ticker", reporterHash: "r1", createdAt: "2026-06-13" });
    await insertReport(db, { handle: "h", shortcode: "AAA", ticker: "AAPL", reason: "wrong-ticker", reporterHash: "r1", createdAt: "2026-06-13" }); // dup → ignored
    await insertReport(db, { handle: "h", shortcode: "AAA", ticker: "AAPL", reason: "not-a-buy", reporterHash: "r2", createdAt: "2026-06-13" });
    const q = await reportQueue(db);
    expect(q[0]).toMatchObject({ handle: "h", shortcode: "AAA", ticker: "AAPL", count: 2 });
  });

  test("REPORT_REASONS is the closed enum the endpoint validates against", () => {
    expect(REPORT_REASONS).toContain("wrong-ticker");
  });
});
