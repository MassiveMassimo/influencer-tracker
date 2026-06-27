/**
 * Best-effort ISR cache-buster for a single creator.
 *
 * GETs each affected path with `x-prerender-revalidate: <token>` to trigger
 * Vercel's on-demand prerender bypass. Never throws — the 6h TTL heals any
 * transient failure automatically.
 *
 * Usage: bun run scripts/revalidate-creator.ts <handle>
 */

import { readFileSync } from "fs";

/** Returns the canonical set of paths that must be revalidated for a creator. */
export function revalidatePaths(handle: string, tickers: string[]): string[] {
  const uniqueTickers = [...new Set(tickers)];
  return [
    `/c/${handle}`,
    `/api/dataset/${handle}`,
    "/explore",
    "/api/calls-index",
    ...uniqueTickers.map((t) => `/t/${t}`),
    ...uniqueTickers.map((t) => `/api/prices/${t}`),
  ];
}

if (import.meta.main) {
  const handle = process.argv[2];
  if (!handle) {
    console.error("Usage: bun run scripts/revalidate-creator.ts <handle>");
    process.exit(1);
  }

  const token = process.env.REVALIDATE_TOKEN;
  if (!token) {
    console.warn("REVALIDATE_TOKEN unset — skipping on-demand revalidate (TTL still applies)");
    process.exit(0);
  }

  // Read dataset to derive the tickers called by this creator.
  const datasetPath = `data/creators/${handle}/dataset.json`;
  let tickers: string[] = [];
  try {
    const raw = readFileSync(datasetPath, "utf-8");
    const dataset = JSON.parse(raw) as { calls: { ticker: string }[] };
    tickers = dataset.calls.map((c) => c.ticker);
  } catch (err) {
    console.error(`Failed to read ${datasetPath}:`, err);
    process.exit(1);
  }

  const origin = process.env.VITE_SITE_URL ?? "https://influencer-tracker-beta.vercel.app";
  const paths = revalidatePaths(handle, tickers);

  for (const path of paths) {
    try {
      const res = await fetch(origin + path, {
        headers: { "x-prerender-revalidate": token },
      });
      if (res.ok) {
        console.log(`ok   ${path}`);
      } else {
        console.warn(`${res.status} ${path}`);
      }
    } catch (err) {
      console.error(`err  ${path}:`, err);
    }
  }
}
