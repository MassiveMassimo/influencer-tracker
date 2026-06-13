import { readFile } from "node:fs/promises";
import { $ } from "bun";
const handle = process.argv[2];
if (!handle) { console.error("usage: resume <handle>"); process.exit(1); }
// 1. Guard against a truncated scrape BEFORE score overwrites the committed baseline.
await $`bun run scripts/guard-no-shrink.ts ${handle}`;
// 2. Score (reads name from the committed dataset so updateIndex doesn't rename the creator).
const name = JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8")).creator?.name ?? handle;
await $`bun run pipeline:x --handle ${handle} --name ${name} --from prices`;
// 3. Sync to Neon + parity, then best-effort cache-bust.
// Scoped sync: backfill ONLY this reviewed creator (a global db:sync would upsert other
// creators' daily-reset stale static over their live DB and trip the row-count guard),
// re-materialize the global artifact from the DB, then scoped parity for this creator.
await $`bun run scripts/backfill.ts ${handle}`;
await $`bun run db:materialize`;
await $`bun run scripts/parity-check.ts ${handle}`;
await $`bun run scripts/revalidate-creator.ts ${handle}`.nothrow();
