import {
  pgTable,
  text,
  doublePrecision,
  boolean,
  jsonb,
  integer,
  primaryKey,
  index,
  foreignKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// One row per creator. Holds the non-call parts of Dataset verbatim (jsonb) so the
// Dataset shape round-trips losslessly in Plan 1. These jsonb blobs are replaced by
// materialized aggregates in Plan 2/3.
export const creators = pgTable("creators", {
  handle: text("handle").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  ord: integer("ord").notNull(), // position in index.json — deterministic roster order
  generatedAt: text("generated_at").notNull(),
  spyAnchor: text("spy_anchor").notNull(),
  scorecard: jsonb("scorecard").notNull(), // Scorecard
  caveats: jsonb("caveats").notNull(), // string[]
  indexStats: jsonb("index_stats").notNull(), // IndexEntry minus handle/name/avatar
});

// One row per call. Upsert key is (handle, shortcode, ticker): a single post can name
// multiple stocks, so the post (shortcode) alone is not unique — ticker disambiguates the
// distinct calls within one post.
export const calls = pgTable(
  "calls",
  {
    handle: text("handle")
      .notNull()
      .references(() => creators.handle, { onDelete: "cascade" }),
    shortcode: text("shortcode").notNull(),
    ticker: text("ticker").notNull(),
    ord: integer("ord").notNull(), // array index in the source dataset — preserves file order
    postDate: text("post_date").notNull(),
    company: text("company").notNull(),
    isFirstCall: boolean("is_first_call").notNull(),
    conviction: doublePrecision("conviction").notNull(),
    quote: text("quote").notNull(),
    summary: text("summary"),
    onScreenPrice: doublePrecision("on_screen_price"),
    spark: jsonb("spark"), // number[] | null
    returns: jsonb("returns").notNull(), // Record<Horizon, ReturnTriple>
  },
  (t) => [
    primaryKey({ columns: [t.handle, t.shortcode, t.ticker] }),
    index("calls_ticker_idx").on(t.ticker),
    index("calls_post_date_idx").on(t.postDate),
  ],
);

// Shared per-symbol daily OHLC. INSERT-ONLY (enforced by DB role in scripts/apply-roles.ts):
// a frozen scoring input must never be rewritten. Writes only ever insert missing dates.
export const prices = pgTable(
  "prices",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    o: doublePrecision("o").notNull(),
    h: doublePrecision("h").notNull(),
    l: doublePrecision("l").notNull(),
    c: doublePrecision("c").notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

// Materialized serve artifacts (Plan 2+). One row per artifact key; `payload` is the
// precomputed JSON served to the client. Recomputed at ingest in Plan 3; for now via
// `bun run db:materialize`. Kept generic so a leaderboard / other aggregates can be
// added as new keys without a schema change.
export const artifacts = pgTable("artifacts", {
  key: text("key").primaryKey(), // e.g. "calls-index"
  payload: jsonb("payload").notNull(),
  generatedAt: text("generated_at").notNull(),
});

// Operator corrections to a call, applied by score() as a deterministic final pass
// over the extracted ReelCall[] BEFORE the isExplicitBuy&&bullish filter. Each column
// is nullable except the audit reason: a null field means "leave as classified", a
// non-null field overrides it. This is the durable, auditable replacement for
// hand-editing reel-calls.json (lost on re-extract) and for the owner-DELETE (which
// loses the evidence). Serve role must NOT see this table (see scripts/apply-roles.ts).
export const callOverrides = pgTable(
  "call_overrides",
  {
    handle: text("handle")
      .notNull()
      .references(() => creators.handle, { onDelete: "cascade" }),
    shortcode: text("shortcode").notNull(),
    // Which call within the post this override targets, matched against the classified
    // ticker (raw or canonical). Empty string = legacy/whole-post (pre-multi-stock, when a
    // post had exactly one call) — applies to every call in that post. Part of the PK, so
    // it cannot be NULL (Postgres PKs are NOT NULL); the empty string is the legacy sentinel.
    targetTicker: text("target_ticker").notNull().default(""),
    ticker: text("ticker"), // null = keep classified ticker; else retag to this symbol
    isExplicitBuy: boolean("is_explicit_buy"), // null = keep classified flag
    direction: text("direction"), // null = keep; else "bullish"|"bearish"|"neutral"
    reason: text("reason").notNull(), // required audit trail (verbatim quote + why)
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.handle, t.shortcode, t.targetTicker] }), // one (latest-wins) override per targeted call
  ],
);

// One row per (call, reporter) flag from the public "Report incorrect" control. FK to
// calls so a report for a non-existent call is rejected at the DB without the report
// role needing SELECT. The unique (handle, shortcode, reporterHash) dedupe bounds spam
// to one report per reporter per call (onConflictDoNothing). reporterHash is a salted,
// non-reversible hash of the client IP (see src/routes/api/report.ts) — operational
// dedupe only, never displayed. reason is a closed enum (validated at the endpoint).
// Serve role must NOT see this table.
export const callReports = pgTable(
  "call_reports",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    handle: text("handle").notNull(),
    shortcode: text("shortcode").notNull(),
    ticker: text("ticker").notNull(), // which call within the post is flagged (calls PK is 3-col)
    reason: text("reason").notNull(), // enum: wrong-ticker|not-a-buy|wrong-direction|not-a-call|other
    reporterHash: text("reporter_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.handle, t.shortcode, t.ticker],
      foreignColumns: [calls.handle, calls.shortcode, calls.ticker],
    }).onDelete("cascade"),
    uniqueIndex("call_reports_dedupe_idx").on(t.handle, t.shortcode, t.ticker, t.reporterHash),
    index("call_reports_call_idx").on(t.handle, t.shortcode, t.ticker),
  ],
);
