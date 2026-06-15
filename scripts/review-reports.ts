// Operator review queue: print reported calls ranked by distinct-reporter count, joined
// with the call's current ticker/quote so the operator can decide on an override. Reads
// via the ingest role (getWriteDb). Run over SSH on the VM, or locally against prod.
//
// Usage:
//   bun run scripts/review-reports.ts
import { getWriteDb } from "../db/client";
import { reportQueue } from "../db/reports";
import { calls } from "../db/schema";
import { and, eq } from "drizzle-orm";

const db = getWriteDb();
const q = await reportQueue(db);
if (!q.length) { console.log("no reports."); process.exit(0); }
for (const r of q) {
  // A post can name multiple stocks, so the queue is keyed by (handle, shortcode, ticker) —
  // look up the exact reported call, not just the post.
  const [call] = await db.select().from(calls)
    .where(and(eq(calls.handle, r.handle), eq(calls.shortcode, r.shortcode), eq(calls.ticker, r.ticker)));
  console.log(`\n[${r.count}] ${r.handle}/${r.shortcode} (${r.ticker})  reasons: ${r.reasons.join(", ")}`);
  // isFirstCall is the schema column for the explicit-buy flag (calls table has no isExplicitBuy;
  // that column only exists on call_overrides). quote is notNull in schema but guarded for safety.
  if (call) console.log(`    current: ${call.ticker} buy=${call.isFirstCall} "${(call.quote ?? "").slice(0, 80)}"`);
  // --target pins the override to this call within the post (required for multi-stock posts).
  console.log(`    fix: bun run scripts/apply-override.ts ${r.handle} ${r.shortcode} --target ${r.ticker} --reason "..." [--ticker X] [--buy false]`);
}
