import { createServerFn } from "@tanstack/react-start";
import { DatasetSchema } from "./schema";
import type { Dataset } from "./types";
import { loadIndex } from "./dataset-source";
import { siteUrl } from "../og/site";

// index.json is tiny and hit on every page, so keep it bundled in the function.
export const listCreators = createServerFn({ method: "GET" }).handler(
  async () => loadIndex(),
);

// Datasets are large (MBs) and immutable per deploy, so they ship as static CDN
// assets (public/datasets/<handle>.json, copied at build) instead of being bundled
// into the server function. This is a plain fn (NOT a server fn) so it runs wherever
// it's called: on the client it fetches the same-origin static file (browser-cached,
// gzipped, reused across navigations); during SSR the function fetches it from the
// edge. Keeps the data out of the function bundle.
export async function fetchDataset(handle: string): Promise<Dataset> {
  const path = `/datasets/${handle}.json`;
  // SSR/server needs an absolute URL; the client uses the relative same-origin path.
  const url = typeof window === "undefined" ? siteUrl(path) : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`dataset ${handle}: ${res.status}`);
  return DatasetSchema.parse(await res.json());
}
