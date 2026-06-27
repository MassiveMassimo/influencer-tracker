import { readFile } from "node:fs/promises";
import { $ } from "bun";
import { pipelineFor } from "./pipeline-for";
const handle = process.argv[2];
const platform = process.argv[3]; // "ig" | "x" | undefined (default x)
if (!handle) {
  console.error("usage: resume <handle> [ig|x]");
  process.exit(1);
}
// Invoke nested stages through THIS bun's absolute path (process.execPath), not a bare
// `bun` that depends on PATH. The systemd unit sets PATH, but a manual run over a
// non-login SSH shell has no ~/.bun/bin on PATH, so a bare nested `bun` would fail.
const bun = process.execPath;
const pipeline = pipelineFor(platform);
// 1. Guard against a truncated scrape BEFORE score overwrites the committed baseline.
await $`${bun} run scripts/guard-no-shrink.ts ${handle}`;
// 2. Score (reads name from the committed dataset so updateIndex doesn't rename the creator).
//    score applies operator overrides (db/overrides.ts, fail-open) before writing dataset.json.
//    prices+score are platform-agnostic; the IG and X orchestrators expose the same --from prices.
const name =
  JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8")).creator?.name ??
  handle;
await $`${bun} run ${pipeline} --handle ${handle} --name ${name} --from prices`;
// Static-serve model: data/ (dataset.json + index.json + prices) is the source of truth; the
// serve path reads the committed static assets (USE_DB=0), so there is no per-creator DB sync,
// materialize, parity, or ISR revalidate here anymore. ingest.ts commits + pushes the refreshed
// data/ once after all handles, which redeploys Vercel and serves the fresh static. For a manual
// override re-score: run this, then `git add data/ && git commit && git push` to publish.
