import { readFile } from "node:fs/promises";
// Refuse to sync if the freshly-scored call set is materially smaller than what's
// already published — the signature of an unseeded/partial scrape that would erase history.
export function wouldShrink(existing: number, incoming: number): boolean {
  return existing > 0 && incoming < existing * 0.95;
}
if (import.meta.main) {
  const handle = process.argv[2];
  // Compare LIKE-FOR-LIKE: committed dataset.calls (scored-only baseline) vs the scored
  // subset of the freshly-grown reel-calls. MUST run BEFORE score rewrites dataset.json
  // (stage-1's `git checkout -- data/` leaves dataset.json at the committed baseline).
  const ds = JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8"));
  const rc = JSON.parse(await readFile(`data/creators/${handle}/reel-calls.json`, "utf8"));
  const baseline = (ds.calls ?? []).length;
  const incoming = rc.filter((c: any) => c.isExplicitBuy && c.direction === "bullish").length;
  if (wouldShrink(baseline, incoming)) {
    console.error(`GUARD: ${handle} scored ${incoming} << baseline ${baseline}; refusing sync`);
    process.exit(1);
  }
  console.log(`guard ok: ${handle} scored ${incoming} >= baseline ${baseline}`);
}
