// Build-time precompute. Runs before `vite build` (see package.json) and writes
// into public/, which Vite copies to the static client output (served from the CDN):
//
//  1. public/datasets/<handle>.json  — the large datasets as static immutable assets
//     (fetched by fetchDataset() instead of being bundled into the server function).
//  2. public/og/...png               — every OG card pre-rendered to a static PNG, so
//     crawlers hit the CDN and satori/resvg never run at request time.
//
// OG theme is frozen here (default light; override with OG_THEME=dark). The runtime
// day/night flip is dropped — social platforms cache OG images aggressively, so a
// per-request theme has little real effect, and static-on-CDN is the perf ceiling.
import { mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { renderOgPng, type OgCard } from "../src/og/render.tsx";
import type { OgTheme } from "../src/og/solar.ts";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data", "creators");
const PUB = join(ROOT, "public");
const OG_DIR = join(PUB, "og");
const DS_DIR = join(PUB, "datasets");
const THEME: OgTheme = process.env.OG_THEME === "dark" ? "dark" : "light";

interface IndexEntry {
  handle: string;
  name: string;
  totalCalls: number;
  avgExcess3m: number;
  avatar?: string;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

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

  console.log(
    `prebuild done: ${index.length} creators, ${tickerJobs.length} tickers, datasets copied.`,
  );
}

main();
