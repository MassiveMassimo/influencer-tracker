import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { creators, calls, prices } from "./schema";
import type { Dataset, OhlcBar } from "#/lib/types";
import type { IndexEntry } from "#/lib/dataset-source";

// drizzle `excluded`-row reference for upserts; quote the column to be safe with
// reserved words like `returns`.
const ex = (col: string) => sql.raw(`excluded."${col}"`);

// `ord` (index position) is required by the caller so creator roster order is
// deterministic; pass it from the index array index in the runner.
export async function backfillCreator(
  db: Db,
  indexEntry: IndexEntry,
  ds: Dataset,
  ord: number,
): Promise<void> {
  const { handle, name, avatar, ...indexStats } = indexEntry;
  const creatorRow = {
    handle,
    name,
    avatar: avatar ?? null,
    ord,
    generatedAt: ds.generatedAt,
    spyAnchor: ds.spyAnchor,
    scorecard: ds.scorecard,
    caveats: ds.caveats,
    indexStats,
  };
  await db
    .insert(creators)
    .values(creatorRow)
    .onConflictDoUpdate({
      target: creators.handle,
      set: {
        name,
        avatar: avatar ?? null,
        ord,
        generatedAt: ds.generatedAt,
        spyAnchor: ds.spyAnchor,
        scorecard: ds.scorecard,
        caveats: ds.caveats,
        indexStats,
      },
    });

  if (ds.calls.length === 0) return;
  const rows = ds.calls.map((c, i) => ({
    handle,
    shortcode: c.shortcode,
    ord: i, // array position preserves file order (postDate has ties)
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
    await db
      .insert(calls)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [calls.handle, calls.shortcode, calls.ticker],
        // Update every non-PK column so a re-run after a re-score never leaves stale data.
        // ticker is part of the PK now, so it is the conflict target, not a set column.
        set: {
          ord: ex("ord"),
          postDate: ex("post_date"),
          company: ex("company"),
          isFirstCall: ex("is_first_call"),
          conviction: ex("conviction"),
          quote: ex("quote"),
          summary: ex("summary"),
          onScreenPrice: ex("on_screen_price"),
          spark: ex("spark"),
          returns: ex("returns"),
        },
      });
  }
}

// Insert-only: never updates existing (symbol,date) rows — preserves frozen prices.
// Before inserting, surface any incoming bar whose OHLC differs from a stored bar on
// the same (symbol,date): onConflictDoNothing would silently drop it, which is correct
// for a benign re-run but hides an intentional Yahoo restatement (split/dividend). The
// warn makes that visible — a real restatement is an OWNER-role `UPDATE prices`
// followed by re-score + parity-check (see CLAUDE.md). One pre-query per symbol batch.
export async function backfillPrices(db: Db, symbol: string, bars: OhlcBar[]): Promise<void> {
  if (bars.length === 0) return;

  const existing = await db
    .select()
    .from(prices)
    .where(
      and(
        eq(prices.symbol, symbol),
        inArray(
          prices.date,
          bars.map((b) => b.date),
        ),
      ),
    );
  if (existing.length > 0) {
    const stored = new Map(existing.map((r) => [r.date, r]));
    // Compare with an epsilon, not ===: doublePrecision round-trips losslessly in practice but
    // a precision change upstream shouldn't spam warns. A real restatement (split/dividend) moves
    // values far more than 1e-9, so this still catches genuine drift.
    const differs = (x: number, y: number) => Math.abs(x - y) > 1e-9;
    const drifted = bars.filter((b) => {
      const s = stored.get(b.date);
      return (
        s && (differs(s.o, b.o) || differs(s.h, b.h) || differs(s.l, b.l) || differs(s.c, b.c))
      );
    });
    if (drifted.length > 0) {
      console.warn(
        `[backfillPrices] ${symbol}: ${drifted.length} incoming bar(s) differ from frozen ` +
          `stored values and will be dropped (insert-only). Dates: ` +
          `${drifted.map((b) => b.date).join(", ")}. ` +
          `If this is an intentional restatement, UPDATE prices as the DB owner, then re-score + parity-check.`,
      );
    }
  }

  await db
    .insert(prices)
    .values(bars.map((b) => ({ symbol, date: b.date, o: b.o, h: b.h, l: b.l, c: b.c })))
    .onConflictDoNothing();
}
