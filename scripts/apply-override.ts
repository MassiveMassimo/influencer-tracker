// Operator CLI: record a durable correction for one call, then tell the operator the
// re-score command. Writes call_overrides via the ingest role (getWriteDb). The override
// takes effect on the next score() for that creator (scripts/resume.ts already runs
// score → backfill → materialize → parity → revalidate).
//
// Usage:
//   bun run scripts/apply-override.ts <handle> <shortcode> --reason "<why>" \
//     [--ticker AMD] [--buy false] [--direction bullish]
import { getWriteDb } from "../db/client";
import { callOverrides } from "../db/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const [handle, shortcode] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const reason = arg("reason");
if (!handle || !shortcode || !reason) {
  console.error('usage: apply-override.ts <handle> <shortcode> --reason "<why>" [--ticker X] [--buy true|false] [--direction bullish|bearish|neutral]');
  process.exit(1);
}
const buyArg = arg("buy");
const isExplicitBuy = buyArg === undefined ? null : buyArg === "true";
const today = new Date().toISOString().slice(0, 10);

const db = getWriteDb();
await db.insert(callOverrides).values({
  handle, shortcode, ticker: arg("ticker") ?? null, isExplicitBuy,
  direction: arg("direction") ?? null, reason, createdAt: today,
}).onConflictDoUpdate({
  target: [callOverrides.handle, callOverrides.shortcode],
  set: { ticker: arg("ticker") ?? null, isExplicitBuy, direction: arg("direction") ?? null, reason, createdAt: today },
});
console.log(`override recorded for ${handle}/${shortcode}. Re-score to apply:`);
console.log(`  flock /tmp/influencer-ingest.lock bun run scripts/resume.ts ${handle}`);
