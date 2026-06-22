import { readFile } from "node:fs/promises";
import { $ } from "bun";
const handle = process.argv[2];
if (!handle) { console.error("usage: resume <handle>"); process.exit(1); }
// Invoke nested stages through THIS bun's absolute path (process.execPath), not a bare
// `bun` that depends on PATH. The systemd unit sets PATH, but a manual run over a
// non-login SSH shell (e.g. `~/.bun/bin/bun run scripts/resume.ts`) has no ~/.bun/bin on
// PATH, so a bare nested `bun` would fail "command not found".
const bun = process.execPath;
// 1. Guard against a truncated scrape BEFORE score overwrites the committed baseline.
await $`${bun} run scripts/guard-no-shrink.ts ${handle}`;
// 2. Score (reads name from the committed dataset so updateIndex doesn't rename the creator).
//    score applies operator overrides (db/overrides.ts, fail-open) before writing dataset.json.
const name = JSON.parse(await readFile(`data/creators/${handle}/dataset.json`, "utf8")).creator?.name ?? handle;
await $`${bun} run pipeline:x --handle ${handle} --name ${name} --from prices`;
// Static-serve model: data/ (dataset.json + index.json + prices) is the source of truth; the
// serve path reads the committed static assets (USE_DB=0), so there is no per-creator DB sync,
// materialize, parity, or ISR revalidate here anymore. ingest.ts commits + pushes the refreshed
// data/ once after all handles, which redeploys Vercel and serves the fresh static. For a manual
// override re-score: run this, then `git add data/ && git commit && git push` to publish.
