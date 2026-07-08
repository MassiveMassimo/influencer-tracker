// Build-time precompute. Runs before `vite build` (see package.json) and writes
// into public/, which Vite copies to the static client output (served from the CDN):
//
//  1. public/datasets/<handle>.json  — the large datasets as static immutable assets
//     (fetched by fetchDataset() instead of being bundled into the server function).
//  2. public/og.png + public/og/changelog.png — only the content-stable home +
//     changelog cards, pre-rendered to static PNGs (satori/resvg never run at request
//     time for them). Data-driven creator/ticker cards render on demand via the
//     /api/og/{c,t}/* routes instead (see emit() callers below).
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
import { buildCallsIndex } from "../src/lib/call-index";
import type { Dataset } from "../src/lib/types";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data", "creators");
const PUB = join(ROOT, "public");
const OG_DIR = join(PUB, "og");
const DS_DIR = join(PUB, "datasets");
const PRICES_DST = join(PUB, "prices");
const AVATARS_SRC = join(ROOT, "data", "avatars");
const AVATARS_DST = join(PUB, "avatars");
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

async function main() {
  rmSync(OG_DIR, { recursive: true, force: true });
  rmSync(DS_DIR, { recursive: true, force: true });
  mkdirSync(OG_DIR, { recursive: true });
  mkdirSync(DS_DIR, { recursive: true });
  rmSync(PRICES_DST, { recursive: true, force: true });
  rmSync(AVATARS_DST, { recursive: true, force: true });

  const index: IndexEntry[] = readJson(join(DATA, "index.json"));

  // Static cards: home + changelog (both content-stable). Creator + ticker cards are
  // rendered on demand by the /api/og/{c,t}/* routes (dynamic, DB-fresh). See
  // docs/superpowers/specs/2026-06-15-dynamic-og-images-design.md.
  await emit({ kind: "home", theme: THEME }, join(OG_DIR, "..", "og.png"));
  await emit({ kind: "changelog", theme: THEME }, join(OG_DIR, "changelog.png"));

  // Per-creator: copy the dataset as a static CDN asset (panic fallback for the API
  // read routes) and collect datasets for the calls-index / llms.txt below.
  const datasets: Dataset[] = [];
  for (const e of index) {
    const ds = readJson(join(DATA, e.handle, "dataset.json"));
    datasets.push(ds as Dataset);
    cpSync(join(DATA, e.handle, "dataset.json"), join(DS_DIR, `${e.handle}.json`));
  }

  // Prices: emit per-symbol JSON from the SQLite store for the CDN fallback.
  // The DB is the frozen, insert-only source; prebuild unpacks it to the loose
  // JSON shape the ticker-page fallback fetches at runtime (/prices/<sym>.json).
  const { listSymbolsDb, readPricesDb, closePricesDb, pricesDbExists } = await import(
    "../pipeline/prices-db"
  );
  if (pricesDbExists()) {
    mkdirSync(PRICES_DST, { recursive: true });
    for (const sym of listSymbolsDb()) {
      writeFileSync(join(PRICES_DST, `${sym}.json`), JSON.stringify(readPricesDb(sym)));
    }
    closePricesDb();
  }

  if (existsSync(AVATARS_SRC)) {
    mkdirSync(AVATARS_DST, { recursive: true });
    cpSync(AVATARS_SRC, AVATARS_DST, { recursive: true });
  }

  writeFileSync(join(PUB, "calls-index.json"), JSON.stringify(buildCallsIndex(datasets)));
  writeFileSync(join(PUB, "llms.txt"), buildLlmsTxt(index));

  console.log(`prebuild done: ${index.length} creators, datasets + llms.txt + calls-index copied.`);
}

main();
