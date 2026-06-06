// Build-time precompute. Runs before `vite build` (see package.json) and writes
// into public/, which Vite copies to the static client output (served from the CDN):
//
//  1. public/datasets/<handle>.json  — the large datasets as static immutable assets
//     (fetched by fetchDataset() instead of being bundled into the server function).
//  2. public/og/...png               — every OG card pre-rendered to a static PNG, so
//     crawlers hit the CDN and satori/resvg never run at request time.
//  3. public/llms.txt                 — agent-readable site index (llmstxt.org): summary,
//     per-creator stats, and the machine-readable dataset URLs.
//
// OG theme is frozen to dark. The runtime day/night flip is dropped — social
// platforms cache OG images aggressively, so a per-request theme has little real
// effect, and static-on-CDN is the perf ceiling. The renderer still supports
// "light" (see src/og), it's just never baked.
import { mkdirSync, rmSync, writeFileSync, readFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderOgPng, type OgCard } from "../src/og/render.tsx";
import type { OgTheme } from "../src/og/solar.ts";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data", "creators");
const PUB = join(ROOT, "public");
const OG_DIR = join(PUB, "og");
const DS_DIR = join(PUB, "datasets");
const PRICES_SRC = join(ROOT, "data", "prices");
const PRICES_DST = join(PUB, "prices");
const THEME: OgTheme = "dark";

interface IndexEntry {
  handle: string;
  name: string;
  totalCalls: number;
  hitRate3m: number;
  hitRate3mN: number;
  avgExcess3m: number;
  generatedAt: string;
  avatar?: string;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

// Build /llms.txt — an agent-readable index (llmstxt.org): site summary, per-creator
// stats, and the machine-readable dataset URLs. Absolute URLs when VITE_SITE_URL is set
// (Vercel build env), relative otherwise — both are valid llms.txt.
function buildLlmsTxt(index: IndexEntry[]): string {
  const base = (process.env.VITE_SITE_URL ?? "").replace(/\/$/, "");
  const url = (p: string) => `${base}${p}`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const signed = (x: number) => `${x >= 0 ? "+" : "-"}${(Math.abs(x) * 100).toFixed(1)}%`;

  const creators = index
    .map(
      (e) =>
        `- [${e.name} (@${e.handle})](${url(`/c/${e.handle}`)}): ${e.totalCalls} calls · ` +
        `3-month hit rate ${pct(e.hitRate3m)} (n=${e.hitRate3mN}) · ` +
        `avg 3-month excess vs SPY ${signed(e.avgExcess3m)} · updated ${e.generatedAt}`,
    )
    .join("\n");

  const datasets = index
    .map((e) => `- [${e.name} dataset (JSON)](${url(`/datasets/${e.handle}.json`)})`)
    .join("\n");

  return `# Signal Tracker

> Scores finfluencer stock calls against forward prices, net of SPY. Only explicit
> bullish calls are scored; accuracy is the forward return minus SPY over the same
> window, at 1 week / 1 month / 3 months / to date.

## Creators

${creators}

## Data

Each creator is a self-contained, machine-readable dataset (creator, calls, scorecard,
caveats) as JSON:

${datasets}

Baked daily OHLC per ticker is served at ${url("/prices/")}<SYMBOL>.json (e.g. ${url("/prices/SPY.json")}).

## About

- Methodology: forward returns are measured from each post's date, net of SPY (excess return).
- Sources: each call links to its original Instagram reel or X/Twitter post.
`;
}

// Render `card` to a PNG file, creating parent dirs as needed.
async function emit(card: OgCard, outPath: string) {
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, await renderOgPng(card));
}

// Bounded-concurrency map — overlaps satori (async) across the ~220 renders.
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
        if (++done % 25 === 0) console.log(`  …${done}/${items.length}`);
      }
    }),
  );
}

async function main() {
  rmSync(OG_DIR, { recursive: true, force: true });
  rmSync(DS_DIR, { recursive: true, force: true });
  mkdirSync(OG_DIR, { recursive: true });
  mkdirSync(DS_DIR, { recursive: true });
  rmSync(PRICES_DST, { recursive: true, force: true });

  const index: IndexEntry[] = readJson(join(DATA, "index.json"));

  // Home + one card per creator.
  await emit({ kind: "home", theme: THEME }, join(OG_DIR, "..", "og.png"));
  for (const e of index) {
    await emit(
      {
        kind: "creator",
        theme: THEME,
        name: e.name,
        handle: e.handle,
        avatar: e.avatar,
        excess3m: e.avgExcess3m,
        totalCalls: e.totalCalls,
      },
      join(OG_DIR, `${e.handle}.png`),
    );
  }

  // Per-creator: copy the dataset as a static asset, then one card per called ticker.
  let tickerJobs: { card: OgCard; out: string }[] = [];
  for (const e of index) {
    const ds = readJson(join(DATA, e.handle, "dataset.json"));
    cpSync(join(DATA, e.handle, "dataset.json"), join(DS_DIR, `${e.handle}.json`));
    const tickers = [...new Set(ds.calls.map((c: { ticker: string }) => c.ticker))] as string[];
    for (const symbol of tickers) {
      const calls = ds.calls.filter((c: { ticker: string }) => c.ticker === symbol);
      tickerJobs.push({
        card: {
          kind: "ticker",
          theme: THEME,
          symbol,
          company: calls[0]?.company,
          name: ds.creator.name,
          handle: ds.creator.handle,
          excess3m: calls[0]?.returns?.["3m"]?.excess ?? null,
        },
        out: join(OG_DIR, e.handle, `${symbol}.png`),
      });
    }
  }
  console.log(`rendering ${tickerJobs.length} ticker cards (theme=${THEME})…`);
  await pool(tickerJobs, 8, (j) => emit(j.card, j.out));

  if (existsSync(PRICES_SRC)) {
    mkdirSync(PRICES_DST, { recursive: true });
    cpSync(PRICES_SRC, PRICES_DST, { recursive: true });
  }

  writeFileSync(join(PUB, "llms.txt"), buildLlmsTxt(index));

  console.log(
    `prebuild done: ${index.length} creators, ${tickerJobs.length} tickers, datasets + llms.txt copied.`,
  );
}

main();
