import { z } from "zod";
import type { Dataset } from "./types";

// Slim, cross-creator projection of a scored call. Excludes heavy fields (quote, spark,
// full returns map) so the entire corpus ships as one cached asset for client-side
// filter/sort/search. `ex*` / `stockToDate` are the sortable/filterable scoring metrics;
// join creator name/avatar from the roster (index.json) client-side.
export interface CallIndexEntry {
  handle: string;
  shortcode: string;
  ticker: string;
  company: string;
  postDate: string;
  isFirstCall: boolean;
  conviction: number;
  ex3m: number | null; // returns["3m"].excess
  exToDate: number | null; // returns.toDate.excess
  stockToDate: number | null; // returns.toDate.stock
  summary?: string;
}

export const CallIndexEntrySchema = z.object({
  handle: z.string(),
  shortcode: z.string(),
  ticker: z.string(),
  company: z.string(),
  postDate: z.string(),
  isFirstCall: z.boolean(),
  conviction: z.number(),
  ex3m: z.number().nullable(),
  exToDate: z.number().nullable(),
  stockToDate: z.number().nullable(),
  summary: z.string().optional(),
});
export const CallIndexSchema = z.array(CallIndexEntrySchema);

// Flatten all creators' scored calls into the slim cross-creator index. Sort is
// deterministic (postDate desc, handle asc, shortcode asc, ticker asc) so the artifact
// is stable across rebuilds — the ticker tiebreaker keeps multi-stock posts (which share
// a shortcode) in a fixed order. A stable payload keeps cache busting meaningful in Plan 3.
export function buildCallsIndex(datasets: Dataset[]): CallIndexEntry[] {
  const rows: CallIndexEntry[] = [];
  for (const d of datasets) {
    const handle = d.creator.handle;
    for (const c of d.calls) {
      rows.push({
        handle,
        shortcode: c.shortcode,
        ticker: c.ticker,
        company: c.company,
        postDate: c.postDate,
        isFirstCall: c.isFirstCall,
        conviction: c.conviction,
        ex3m: c.returns["3m"].excess,
        exToDate: c.returns.toDate.excess,
        stockToDate: c.returns.toDate.stock,
        ...(c.summary != null ? { summary: c.summary } : {}),
      });
    }
  }
  rows.sort(
    (a, b) =>
      b.postDate.localeCompare(a.postDate) ||
      a.handle.localeCompare(b.handle) ||
      a.shortcode.localeCompare(b.shortcode) ||
      a.ticker.localeCompare(b.ticker),
  );
  return rows;
}
