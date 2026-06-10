import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema, PriceFileSchema } from "./schema";
import { CallIndexSchema, type CallIndexEntry } from "./call-index";
import type { Dataset, OhlcBar } from "./types";
import { loadIndex } from "./dataset-source";
import { siteUrl } from "../og/site";

// import.meta.env.SSR is statically replaced with `false` in the client build, so Rollup
// dead-code-eliminates the DB branch and never emits the neon/drizzle chunks at all. The
// window guard stays as belt-and-braces. (Plan 1 review finding: the runtime-only window
// check left neon as dead-but-present ~225 KB client chunks.)
const serverUseDb = () => import.meta.env.SSR && typeof window === "undefined" && process.env.USE_DB === "1";

export const listCreators = createServerFn({ method: "GET" }).handler(async () => {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readIndex } = await import("./db-read");
      return await readIndex(getDb());
    } catch (e) {
      console.error("listCreators DB fallback", e);
    }
  }
  return loadIndex();
});

// Datasets are large (MBs). On the static path they ship as CDN assets (public/datasets/<h>.json);
// under USE_DB they're reassembled from Postgres during SSR. The browser always uses the static
// same-origin asset (browser-cached, gzipped) so the DB stays out of the client bundle.
export async function fetchDataset(handle: string): Promise<Dataset> {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readDataset } = await import("./db-read");
      return await readDataset(getDb(), handle);
    } catch (e) {
      console.error(`fetchDataset DB fallback ${handle}`, e);
    }
  }
  const path = `/datasets/${handle}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset ${handle}: ${res.status}`);
  return DatasetSchema.parse(await res.json());
}

// Shared per-ticker baked OHLC. Ticker-page fallback when the live Yahoo fetch errors.
export async function fetchPrices(symbol: string): Promise<OhlcBar[]> {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readPrices } = await import("./db-read");
      const r = await readPrices(getDb(), symbol);
      if (r.length) return r;
    } catch (e) {
      console.error(`fetchPrices DB fallback ${symbol}`, e);
    }
  }
  const path = `/prices/${symbol}.json`;
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) return [];
  return PriceFileSchema.parse(await res.json());
}

// Slim cross-creator calls index (Plan 2). One cached asset for the /explore and
// /t/$symbol routes; all filter/sort/search is client-side over it. DB-first under
// USE_DB (the artifacts table, refreshed by ingest in Plan 3); static asset otherwise.
export async function fetchCallsIndex(): Promise<CallIndexEntry[]> {
  if (serverUseDb()) {
    try {
      const { getDb } = await import("../../db/client");
      const { readCallsIndex } = await import("./db-read");
      return await readCallsIndex(getDb());
    } catch (e) {
      console.error("fetchCallsIndex DB fallback", e);
    }
  }
  const path = "/calls-index.json";
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`calls-index: ${res.status}`);
  return CallIndexSchema.parse(await res.json());
}
