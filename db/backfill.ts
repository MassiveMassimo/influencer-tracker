import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { creators, calls, prices } from "./schema";
import type { Dataset, OhlcBar } from "#/lib/types";
import type { IndexEntry } from "#/lib/dataset-source";

// drizzle `excluded`-row reference for upserts; quote the column to be safe with
// reserved words like `returns`.
const ex = (col: string) => sql.raw(`excluded."${col}"`);

// `ord` (index position) is required by the caller so creator roster order is
// deterministic; pass it from the index array index in the runner.
export async function backfillCreator(db: Db, indexEntry: IndexEntry, ds: Dataset, ord: number): Promise<void> {
  const { handle, name, avatar, ...indexStats } = indexEntry;
  const creatorRow = {
    handle, name, avatar: avatar ?? null, ord,
    generatedAt: ds.generatedAt, spyAnchor: ds.spyAnchor,
    scorecard: ds.scorecard, caveats: ds.caveats, indexStats,
  };
  await db.insert(creators).values(creatorRow).onConflictDoUpdate({
    target: creators.handle,
    set: { name, avatar: avatar ?? null, ord, generatedAt: ds.generatedAt,
      spyAnchor: ds.spyAnchor, scorecard: ds.scorecard, caveats: ds.caveats, indexStats },
  });

  if (ds.calls.length === 0) return;
  const rows = ds.calls.map((c, i) => ({
    handle,
    shortcode: c.shortcode,
    ord: i,                               // array position preserves file order (postDate has ties)
    postDate: c.postDate,
    ticker: c.ticker,
    company: c.company,
    isFirstCall: c.isFirstCall,
    conviction: c.conviction,
    quote: c.quote,
    summary: c.summary ?? null,
    onScreenPrice: c.onScreenPrice ?? null,
    spark: c.spark ?? null,
    returns: c.returns,
  }));
  // Chunk to keep each neon-http request body well under limits.
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(calls).values(rows.slice(i, i + 200)).onConflictDoUpdate({
      target: [calls.handle, calls.shortcode],
      // Update every non-PK column so a re-run after a re-score never leaves stale data.
      set: {
        ord: ex("ord"), postDate: ex("post_date"), ticker: ex("ticker"), company: ex("company"),
        isFirstCall: ex("is_first_call"), conviction: ex("conviction"), quote: ex("quote"),
        summary: ex("summary"), onScreenPrice: ex("on_screen_price"), spark: ex("spark"),
        returns: ex("returns"),
      },
    });
  }
}

// Insert-only: never updates existing (symbol,date) rows — preserves frozen prices.
export async function backfillPrices(db: Db, symbol: string, bars: OhlcBar[]): Promise<void> {
  if (bars.length === 0) return;
  await db.insert(prices).values(bars.map((b) => ({ symbol, date: b.date, o: b.o, h: b.h, l: b.l, c: b.c })))
    .onConflictDoNothing();
}
