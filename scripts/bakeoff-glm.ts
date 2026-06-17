// Classifier bake-off: compare two text models on the X extract (classify) stage.
// Runs BOTH models live on the SAME sampled tweet bodies (vision hints computed
// once, shared) so the comparison isolates the text classifier. The committed
// reel-calls.json is NOT used as a baseline — it may predate the current prompt,
// so both models are re-run live under the same CLASSIFY_SYS.
//
//   bun run scripts/bakeoff-glm.ts [handle] [sampleSize]
//
// Edit the model constants below to compare other candidates. Emits a markdown
// disagreement report (bakeoff-glm5p2-<handle>.md, gitignored) for human
// adjudication vs calls.review.md. 2026-06-17 run: GLM-5.2 ~= deepseek at ~10-15x
// cost (see memory glm-5p2-bakeoff); deepseek-v4-flash kept.

import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rawDir } from "../pipeline/config";
import { fireworks } from "../pipeline/fireworks";
import { classify, toReelCalls } from "../pipeline/calls";
import { readImage, type FrameHint } from "../pipeline/vision";
import { tweetDate } from "../pipeline/x/extract-x";
import type { TweetRecord } from "../pipeline/x/scrape-x";
import type { ReelCall } from "../src/lib/types";

const DEEPSEEK = "accounts/fireworks/models/deepseek-v4-flash";
const GLM = "accounts/fireworks/models/glm-5p2";
const VISION = "accounts/fireworks/models/kimi-k2p5";

const handle = process.argv[2] ?? "TheProfInvestor";
const N = Number(process.argv[3]) || 200;
const CONCURRENCY = 24;

// Deterministic spread sample: sort by date, stride across the full range so the
// sample covers old + recent posts, not just one window.
function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

async function bodyFor(t: TweetRecord): Promise<string> {
  const dir = join(rawDir(handle), t.id);
  let hints: FrameHint[] = [];
  if (existsSync(dir)) {
    const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
    hints = await Promise.all(files.map((f) => readImage(VISION, join(dir, f), fireworks)));
  }
  return `TWEET:\n${t.text}\n\nIMAGE HINTS:\n${JSON.stringify(hints)}`;
}

interface Row {
  id: string;
  text: string;
  ds: ReelCall[];
  glm: ReelCall[];
  dsMs: number;
  glmMs: number;
}

async function run() {
  const tweets: TweetRecord[] = JSON.parse(
    await readFile(join(rawDir(handle), "tweets.json"), "utf8"),
  );
  const sorted = [...tweets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const picked = sample(sorted, N);
  console.log(`bake-off: ${picked.length}/${tweets.length} tweets, ${handle}`);

  const rows: Row[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < picked.length) {
      const t = picked[next++];
      try {
        const body = await bodyFor(t);
        const date = tweetDate(t.createdAt);
        const t0 = performance.now();
        const ds = toReelCalls(await classify(DEEPSEEK, body, fireworks), t.id, date);
        const t1 = performance.now();
        const glm = toReelCalls(await classify(GLM, body, fireworks), t.id, date);
        const t2 = performance.now();
        rows.push({ id: t.id, text: t.text, ds, glm, dsMs: t1 - t0, glmMs: t2 - t1 });
      } catch (e) {
        console.warn(`skip ${t.id}: ${(e as Error).message}`);
      }
      if (++done % 20 === 0) console.log(`  ${done}/${picked.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ---- analysis -------------------------------------------------------------
  const tset = (cs: ReelCall[]) => new Set(cs.map((c) => c.ticker));
  const byTicker = (cs: ReelCall[]) => new Map(cs.map((c) => [c.ticker, c]));
  const buys = (cs: ReelCall[]) => cs.filter((c) => c.isExplicitBuy && c.direction === "bullish");

  let tickerSetDiff = 0, buyDiff = 0, dirDiff = 0;
  let dsTickers = 0, glmTickers = 0, dsBuys = 0, glmBuys = 0;
  const disagreements: string[] = [];

  for (const r of rows) {
    const dsS = tset(r.ds), glmS = tset(r.glm);
    dsTickers += dsS.size; glmTickers += glmS.size;
    dsBuys += buys(r.ds).length; glmBuys += buys(r.glm).length;

    const onlyDs = [...dsS].filter((x) => !glmS.has(x));
    const onlyGlm = [...glmS].filter((x) => !dsS.has(x));
    const dm = byTicker(r.ds), gm = byTicker(r.glm);
    const shared = [...dsS].filter((x) => glmS.has(x));
    const buyConflicts = shared.filter((x) => dm.get(x)!.isExplicitBuy !== gm.get(x)!.isExplicitBuy);
    const dirConflicts = shared.filter((x) => dm.get(x)!.direction !== gm.get(x)!.direction);

    if (onlyDs.length || onlyGlm.length) tickerSetDiff++;
    if (buyConflicts.length) buyDiff++;
    if (dirConflicts.length) dirDiff++;

    if (onlyDs.length || onlyGlm.length || buyConflicts.length || dirConflicts.length) {
      const fmt = (c?: ReelCall) =>
        c ? `${c.ticker}/${c.direction}/${c.isExplicitBuy ? "BUY" : "—"}/${c.conviction}` : "∅";
      const lines = [`### ${r.id}`, `> ${r.text.replace(/\n/g, " ").slice(0, 220)}`];
      const all = new Set([...dsS, ...glmS]);
      for (const tk of all) {
        const d = dm.get(tk), g = gm.get(tk);
        if (!d || !g || d.isExplicitBuy !== g.isExplicitBuy || d.direction !== g.direction)
          lines.push(`- **${tk}** — deepseek: ${fmt(d)} | glm: ${fmt(g)}`);
      }
      disagreements.push(lines.join("\n"));
    }
  }

  const avg = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const agreePct = (((rows.length - tickerSetDiff) / rows.length) * 100).toFixed(1);

  const report = [
    `# Bake-off: GLM-5.2 vs deepseek-v4-flash — ${handle}`,
    ``,
    `Sample: ${rows.length} posts (spread across full date range). Same bodies + shared vision hints; temp 0.`,
    ``,
    `## Aggregate`,
    `| metric | deepseek-v4-flash | glm-5.2 |`,
    `|---|---|---|`,
    `| tickers extracted | ${dsTickers} | ${glmTickers} |`,
    `| explicit-buy calls | ${dsBuys} | ${glmBuys} |`,
    `| avg latency / call | ${avg((r) => r.dsMs).toFixed(0)}ms | ${avg((r) => r.glmMs).toFixed(0)}ms |`,
    ``,
    `## Disagreement counts (of ${rows.length} posts)`,
    `- posts with different ticker SET: **${tickerSetDiff}** (${agreePct}% agree)`,
    `- posts with isExplicitBuy conflict on a shared ticker: **${buyDiff}**`,
    `- posts with direction conflict on a shared ticker: **${dirDiff}**`,
    ``,
    `## Disagreements (adjudicate vs calls.review.md)`,
    ``,
    ...disagreements,
  ].join("\n");

  const out = join(process.cwd(), `bakeoff-glm5p2-${handle}.md`);
  await writeFile(out, report);
  console.log(`\n--- SUMMARY ---`);
  console.log(`posts: ${rows.length}`);
  console.log(`tickers  ds=${dsTickers} glm=${glmTickers}`);
  console.log(`buys     ds=${dsBuys} glm=${glmBuys}`);
  console.log(`latency/call  ds=${avg((r) => r.dsMs).toFixed(0)}ms glm=${avg((r) => r.glmMs).toFixed(0)}ms`);
  console.log(`ticker-set agree ${agreePct}%  | buy-conflicts ${buyDiff}  | dir-conflicts ${dirDiff}`);
  console.log(`report: ${out}`);
}

run();
