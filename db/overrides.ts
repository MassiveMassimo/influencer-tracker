import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { callOverrides } from "./schema";
import type { Override } from "../pipeline/overrides";

// Read all overrides for a creator. Returns the pipeline Override shape (drops the
// createdAt audit column the transform doesn't need). Caller (score) is fail-open: a
// DB error there degrades to [] so scoring never breaks because overrides are down.
export async function loadOverrides(db: Db, handle: string): Promise<Override[]> {
  const rows = await db.select().from(callOverrides).where(eq(callOverrides.handle, handle));
  return rows.map((r) => ({
    handle: r.handle,
    shortcode: r.shortcode,
    targetTicker: r.targetTicker,
    ticker: r.ticker,
    isExplicitBuy: r.isExplicitBuy,
    direction: r.direction,
    reason: r.reason,
  }));
}
