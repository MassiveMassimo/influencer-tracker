import { pgTable, text, doublePrecision, boolean, jsonb, integer, primaryKey, index } from "drizzle-orm/pg-core";

// One row per creator. Holds the non-call parts of Dataset verbatim (jsonb) so the
// Dataset shape round-trips losslessly in Plan 1. These jsonb blobs are replaced by
// materialized aggregates in Plan 2/3.
export const creators = pgTable("creators", {
  handle: text("handle").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  ord: integer("ord").notNull(),                  // position in index.json — deterministic roster order
  generatedAt: text("generated_at").notNull(),
  spyAnchor: text("spy_anchor").notNull(),
  scorecard: jsonb("scorecard").notNull(),        // Scorecard
  caveats: jsonb("caveats").notNull(),            // string[]
  indexStats: jsonb("index_stats").notNull(),     // IndexEntry minus handle/name/avatar
});

// One row per call. Upsert key is (handle, shortcode).
export const calls = pgTable("calls", {
  handle: text("handle").notNull().references(() => creators.handle, { onDelete: "cascade" }),
  shortcode: text("shortcode").notNull(),
  ord: integer("ord").notNull(),                  // array index in the source dataset — preserves file order
  postDate: text("post_date").notNull(),
  ticker: text("ticker").notNull(),
  company: text("company").notNull(),
  isFirstCall: boolean("is_first_call").notNull(),
  conviction: doublePrecision("conviction").notNull(),
  quote: text("quote").notNull(),
  summary: text("summary"),
  onScreenPrice: doublePrecision("on_screen_price"),
  spark: jsonb("spark"),                          // number[] | null
  returns: jsonb("returns").notNull(),            // Record<Horizon, ReturnTriple>
}, (t) => [
  primaryKey({ columns: [t.handle, t.shortcode] }),
  index("calls_ticker_idx").on(t.ticker),
  index("calls_post_date_idx").on(t.postDate),
]);

// Shared per-symbol daily OHLC. INSERT-ONLY (enforced by DB role in scripts/apply-roles.ts):
// a frozen scoring input must never be rewritten. Writes only ever insert missing dates.
export const prices = pgTable("prices", {
  symbol: text("symbol").notNull(),
  date: text("date").notNull(),
  o: doublePrecision("o").notNull(),
  h: doublePrecision("h").notNull(),
  l: doublePrecision("l").notNull(),
  c: doublePrecision("c").notNull(),
}, (t) => [
  primaryKey({ columns: [t.symbol, t.date] }),
]);
