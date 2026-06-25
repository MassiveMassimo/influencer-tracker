// One-off: backfill `company` on committed datasets from Yahoo, without a full
// re-score (which needs the gitignored per-creator price/raw state). score.ts now
// derives `company` from the canonical symbol via symbolMeta (symbol-scope.ts); this
// applies the same authoritative names to the calls already in dataset.json — fixing
// the ~50% that the LLM left blank and normalising the rest to one stable name per
// ticker. Reuses symbolMeta so there is one name resolver, no drift vs the pipeline.
// The DB (if ever re-enabled) picks it up on the next re-score / db:sync.
//
// Run: bun run scripts/backfill-company.ts
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { symbolMeta } from "../pipeline/symbol-scope";
import type { Dataset } from "../src/lib/types";

const CREATORS = "data/creators";

const datasets: { handle: string; path: string; ds: Dataset }[] = [];
for (const handle of readdirSync(CREATORS)) {
  const path = join(CREATORS, handle, "dataset.json");
  if (!existsSync(path)) continue;
  datasets.push({ handle, path, ds: JSON.parse(readFileSync(path, "utf8")) });
}

// Resolve every canonical symbol once (cached to data/symbol-meta.json).
const symbols = [...new Set(datasets.flatMap(d => d.ds.calls.map(c => c.ticker)))];
console.log(`resolving names for ${symbols.length} symbols across ${datasets.length} datasets…`);
const meta = await symbolMeta(symbols);

let filled = 0, renamed = 0, unresolved = 0, files = 0;
for (const { handle, path, ds } of datasets) {
  let changed = false;
  for (const c of ds.calls) {
    const name = meta[c.ticker]?.name;
    if (!name) { if (!c.company) unresolved++; continue; }
    if (name === c.company) continue;
    if (!c.company) filled++; else renamed++;
    c.company = name;
    changed = true;
  }
  if (changed) { writeFileSync(path, JSON.stringify(ds, null, 2)); files++; }
  void handle;
}

console.log(`filled ${filled} blank, renamed ${renamed}, still-unresolved ${unresolved}; rewrote ${files} datasets.`);
