import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema, PriceFileSchema } from "./schema";
import { CallIndexSchema, type CallIndexEntry } from "./call-index";
import type { Dataset, OhlcBar } from "./types";
import { loadIndex } from "./dataset-source";
import { siteUrl } from "../og/site";

// Runs the DB read only when USE_DB=1 on the server side; returns null otherwise so callers
// fall back to the static/CDN path. The import.meta.env.SSR literal stays AT THE CALL SITE in
// each fetcher (Rollup DCE); this helper only wraps the runtime USE_DB check + error log.
// `label` identifies the calling fetcher in the fallback log line for Vercel log attribution.
export async function readFromDbOrNull<T>(
  label: string,
  read: () => Promise<T>,
): Promise<T | null> {
  if (typeof window !== "undefined" || process.env.USE_DB !== "1") return null;
  try {
    return await read();
  } catch (e) {
    console.error(`DB read failed (${label}) — falling back`, e);
    return null;
  }
}

export const listCreators = createServerFn({ method: "GET" }).handler(async () => {
  if (import.meta.env.SSR) {
    const r = await readFromDbOrNull("listCreators", async () => {
      const { getDb } = await import("../../db/client");
      const { readIndex } = await import("./db-read");
      return readIndex(getDb());
    });
    if (r != null) return r;
  }
  return loadIndex();
});

// Datasets are large (MBs). On the static path they ship as CDN assets (public/datasets/<h>.json);
// under USE_DB they're reassembled from Postgres during SSR. The browser always uses the static
// same-origin asset (browser-cached, gzipped) so the DB stays out of the client bundle.
export async function fetchDataset(handle: string): Promise<Dataset> {
  if (import.meta.env.SSR) {
    const r = await readFromDbOrNull(`fetchDataset ${handle}`, async () => {
      const { getDb } = await import("../../db/client");
      const { readDataset } = await import("./db-read");
      return readDataset(getDb(), handle);
    });
    if (r != null) return r;
  }
  // Primary: cached API route (DB-fresh under USE_DB; cache-revalidated on CDN).
  // Fallback: deploy-frozen static asset for cold/broken API.
  try {
    const apiPath = `/api/dataset/${handle}`;
    // USE_DB=0 SSR: two hops (fn→/api→CDN); USE_DB=1 in prod reads DB directly above.
    const apiUrl = typeof window === "undefined" ? siteUrl(apiPath) : apiPath;
    const res = await fetch(apiUrl);
    if (res.ok) return DatasetSchema.parse(await res.json());
    throw new Error(`dataset ${handle}: ${res.status}`);
  } catch (e) {
    console.warn(`/api fetch failed (fetchDataset ${handle}) — falling back to static`, e);
    const path = `/datasets/${handle}.json`;
    const url = typeof window === "undefined" ? siteUrl(path) : path;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`dataset ${handle}: ${res.status}`);
    return DatasetSchema.parse(await res.json());
  }
}

// Shared per-ticker baked OHLC. Ticker-page fallback when the live Yahoo fetch errors.
export async function fetchPrices(symbol: string): Promise<OhlcBar[]> {
  if (import.meta.env.SSR) {
    const r = await readFromDbOrNull(`fetchPrices ${symbol}`, async () => {
      const { getDb } = await import("../../db/client");
      const { readPrices } = await import("./db-read");
      return readPrices(getDb(), symbol);
    });
    // Fall through to static if DB returned an empty array (symbol not yet in DB).
    if (r != null && r.length) return r;
  }
  // Primary: cached API route (DB-fresh under USE_DB; cache-revalidated on CDN).
  // Fallback: deploy-frozen static asset on fetch error (catch). A non-OK API response
  // returns [] directly — the API route already serves 200+[] for legitimate misses, so a
  // non-OK here is a true upstream error where the static fetch would also fail. Preserves
  // the original "never throw on missing prices" contract.
  try {
    const apiPath = `/api/prices/${symbol}`;
    // USE_DB=0 SSR: two hops (fn→/api→CDN); USE_DB=1 in prod reads DB directly above.
    const apiUrl = typeof window === "undefined" ? siteUrl(apiPath) : apiPath;
    const res = await fetch(apiUrl);
    if (res.ok) return PriceFileSchema.parse(await res.json());
    return [];
  } catch (e) {
    console.warn(`/api fetch failed (fetchPrices ${symbol}) — falling back to static`, e);
    const path = `/prices/${symbol}.json`;
    const url = typeof window === "undefined" ? siteUrl(path) : path;
    const res = await fetch(url);
    if (!res.ok) return [];
    return PriceFileSchema.parse(await res.json());
  }
}

// Slim cross-creator calls index (Plan 2). One cached asset for the /explore and
// /t/$symbol routes; all filter/sort/search is client-side over it. DB-first under
// USE_DB (the artifacts table, refreshed by ingest in Plan 3); static asset otherwise.
export async function fetchCallsIndex(): Promise<CallIndexEntry[]> {
  if (import.meta.env.SSR) {
    const r = await readFromDbOrNull("fetchCallsIndex", async () => {
      const { getDb } = await import("../../db/client");
      const { readCallsIndex } = await import("./db-read");
      return readCallsIndex(getDb());
    });
    if (r != null) return r;
  }
  // Primary: cached API route (DB-fresh under USE_DB; cache-revalidated on CDN).
  // Fallback: deploy-frozen static asset for cold/broken API.
  try {
    const apiPath = "/api/calls-index";
    // USE_DB=0 SSR: two hops (fn→/api→CDN); USE_DB=1 in prod reads DB directly above.
    const apiUrl = typeof window === "undefined" ? siteUrl(apiPath) : apiPath;
    const res = await fetch(apiUrl);
    if (res.ok) return CallIndexSchema.parse(await res.json());
    throw new Error(`calls-index: ${res.status}`);
  } catch (e) {
    console.warn(`/api fetch failed (fetchCallsIndex) — falling back to static`, e);
    const path = "/calls-index.json";
    const url = typeof window === "undefined" ? siteUrl(path) : path;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`calls-index: ${res.status}`);
    return CallIndexSchema.parse(await res.json());
  }
}
