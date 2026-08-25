import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { creators, calls, prices, artifacts } from "../../db/schema";
import type { Dataset, Call, OhlcBar } from "./types";
import type { IndexEntry } from "./dataset-source";
import { CallIndexSchema, type CallIndexEntry } from "./call-index";
import { CREATOR_CALLS_PAGE_SIZE, type CreatorCallsPage } from "./creator-data";

function rowToCall(r: typeof calls.$inferSelect): Call {
  // onScreenPrice is present on EVERY committed call (explicit `null` on some), so emit it
  // unconditionally — a missing key would break the golden master (missing ≠ null).
  // summary/spark are always present and non-null in the data, so the conditional spread
  // always includes them; kept conditional to honor the optional type.
  return {
    shortcode: r.shortcode,
    postDate: r.postDate,
    ticker: r.ticker,
    company: r.company,
    isFirstCall: r.isFirstCall,
    conviction: r.conviction,
    quote: r.quote,
    ...(r.summary != null ? { summary: r.summary } : {}),
    onScreenPrice: r.onScreenPrice,
    ...(r.spark != null ? { spark: r.spark as number[] } : {}),
    returns: r.returns as Call["returns"],
  };
}

export async function readDataset(db: Db, handle: string): Promise<Dataset> {
  const [c] = await db.select().from(creators).where(eq(creators.handle, handle));
  if (!c) throw new Error(`dataset ${handle}: not found`);
  // `ord` (array index at backfill) reconstructs exact file order — postDate has ties
  // so a date sort would scramble it.
  const callRows = await db
    .select()
    .from(calls)
    .where(eq(calls.handle, handle))
    .orderBy(asc(calls.ord));
  return {
    creator: { handle: c.handle, name: c.name },
    generatedAt: c.generatedAt,
    spyAnchor: c.spyAnchor,
    calls: callRows.map(rowToCall),
    scorecard: c.scorecard as Dataset["scorecard"],
    caveats: c.caveats as string[],
  };
}

export async function readCreatorCallsPage(
  db: Db,
  handle: string,
  requestedPage: number,
): Promise<CreatorCallsPage> {
  const [[creator], [totalRow]] = await Promise.all([
    db.select({ handle: creators.handle }).from(creators).where(eq(creators.handle, handle)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(calls)
      .where(eq(calls.handle, handle)),
  ]);
  if (!creator) throw new Error(`dataset ${handle}: not found`);

  const totalCalls = totalRow?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCalls / CREATOR_CALLS_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, Math.trunc(requestedPage)), pageCount);
  const callRows = await db
    .select()
    .from(calls)
    .where(eq(calls.handle, handle))
    .orderBy(desc(calls.postDate), asc(calls.ord))
    .limit(CREATOR_CALLS_PAGE_SIZE)
    .offset((currentPage - 1) * CREATOR_CALLS_PAGE_SIZE);

  const shortcodes = [...new Set(callRows.map((call) => call.shortcode))];
  const postRows =
    shortcodes.length === 0
      ? []
      : await db
          .select({
            shortcode: calls.shortcode,
            ticker: calls.ticker,
            company: calls.company,
          })
          .from(calls)
          .where(and(eq(calls.handle, handle), inArray(calls.shortcode, shortcodes)))
          .orderBy(asc(calls.ord));

  const posts: CreatorCallsPage["posts"] = {};
  for (const row of postRows) {
    (posts[row.shortcode] ??= []).push({
      ticker: row.ticker,
      company: row.company,
    });
  }

  return {
    calls: callRows.map(rowToCall),
    currentPage,
    pageCount,
    totalCalls,
    posts,
  };
}

export async function readIndex(db: Db): Promise<IndexEntry[]> {
  const rows = await db.select().from(creators).orderBy(asc(creators.ord));
  // An empty creators table means an un-backfilled / broken DB, not a real "no creators"
  // state (the static index always has >=2) — throw so listCreators degrades to the static
  // index instead of serving an empty site (Plan 1 review finding 1; mirrors readCallsIndex).
  if (rows.length === 0) throw new Error("creators table empty — run `bun run db:backfill`");
  return rows.map((c) => ({
    handle: c.handle,
    name: c.name,
    ...(c.avatar != null ? { avatar: c.avatar } : {}),
    ...(c.indexStats as Omit<IndexEntry, "handle" | "name" | "avatar">),
  }));
}

export async function readPrices(db: Db, symbol: string): Promise<OhlcBar[]> {
  const rows = await db
    .select()
    .from(prices)
    .where(eq(prices.symbol, symbol))
    .orderBy(asc(prices.date));
  return rows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
}

export async function readCallsIndex(db: Db): Promise<CallIndexEntry[]> {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.key, "calls-index"));
  if (!row) throw new Error("calls-index artifact missing — run `bun run db:materialize`");
  const parsed = CallIndexSchema.parse(row.payload);
  // An empty index is a DB problem (un-backfilled / mid-ingest), not a real "no calls"
  // state — throw so fetchCallsIndex degrades to the static asset (mirrors Plan 1 finding 1).
  if (parsed.length === 0)
    throw new Error("calls-index artifact empty — run `bun run db:materialize`");
  return parsed;
}
