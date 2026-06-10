import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema, PriceFileSchema } from "./schema";
import type { Dataset, OhlcBar } from "./types";
import { loadIndex } from "./dataset-source";
import { siteUrl } from "../og/site";

// Server-only: window guard FIRST so the client never reads process.env or imports the DB.
// data.ts is reachable from client routes; the DB modules are dynamically imported only
// inside this guarded branch so neon never enters the client bundle.
const serverUseDb = () => typeof window === "undefined" && process.env.USE_DB === "1";

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
