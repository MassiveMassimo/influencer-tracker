// One-off: round baked spark arrays in committed datasets to 4 sig figs.
// `buildSpark` now rounds at score time; this back-fills existing datasets so the
// committed files + static fallback shrink without a full re-score. Only spark
// values change. The DB picks up rounded sparks on the next daily VM re-score.
//
// Run: bun run scripts/round-spark.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CREATORS = "data/creators";
const round4 = (v: number) => Number(v.toPrecision(4));
const roundArr = (s: unknown) =>
  Array.isArray(s) ? s.map((v) => round4(v as number)) : s;

const index: { handle: string }[] = JSON.parse(
  readFileSync(join(CREATORS, "index.json"), "utf8"),
);

for (const { handle } of index) {
  const path = join(CREATORS, handle, "dataset.json");
  const ds = JSON.parse(readFileSync(path, "utf8"));
  let n = 0;
  for (const c of ds.calls ?? []) {
    if (Array.isArray(c.spark)) {
      c.spark = roundArr(c.spark);
      n++;
    }
  }
  // best/worst entries in the scorecard carry their own spark arrays too.
  for (const k of ["best", "worst"] as const) {
    for (const c of ds.scorecard?.[k] ?? []) {
      c.spark = roundArr(c.spark);
    }
  }
  const before = Buffer.byteLength(readFileSync(path));
  // Match score.ts's format (2-space indent) so future re-scores don't churn.
  writeFileSync(path, JSON.stringify(ds, null, 2));
  const after = Buffer.byteLength(readFileSync(path));
  console.log(
    `${handle}: rounded ${n} call sparks · ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`,
  );
}
