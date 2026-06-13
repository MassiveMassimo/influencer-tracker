import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { callReports } from "./schema";

export interface ReportRow {
  handle: string;
  shortcode: string;
  reason: string;
  reporterHash: string;
  createdAt: string;
}

// Insert one report; the unique (handle, shortcode, reporterHash) index makes a repeat
// from the same reporter a no-op. Called through the INSERT-only report role.
export async function insertReport(db: Db, r: ReportRow): Promise<void> {
  await db.insert(callReports).values(r).onConflictDoNothing();
}

// Operator review queue: one row per reported call, ranked by distinct-reporter count,
// with the reasons seen. Read through ingest (has SELECT). Plain SQL aggregate.
export async function reportQueue(db: Db): Promise<{ handle: string; shortcode: string; count: number; reasons: string[] }[]> {
  const rows = await db
    .select({
      handle: callReports.handle,
      shortcode: callReports.shortcode,
      count: sql<number>`count(*)::int`,
      reasons: sql<string[]>`array_agg(distinct ${callReports.reason})`,
    })
    .from(callReports)
    .groupBy(callReports.handle, callReports.shortcode)
    .orderBy(sql`count(*) desc`);
  return rows;
}
