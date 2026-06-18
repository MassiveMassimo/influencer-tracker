// Server-only: queries Musaffa's Typesense `stocks_data` collection. Keep out of
// the client bundle (only halal-fetch's server fn imports this).
import { type HalalInfo, parseRating, musaffaUrl } from "./types.ts";

const HOST = "https://0bs2hegi5nmtad4op.a1.typesense.net";
const SEARCH_PATH = "/collections/stocks_data/documents/search";
const MAX_PER_PAGE = 250;
const REQUEST_TIMEOUT_MS = 15_000;

export class MusaffaOutage extends Error {}

interface TypesenseDoc {
  id?: string;
  ticker?: string;
  musaffaHalalRating?: string;
  sharia_compliance?: string;
  halal_revenue_percent?: number;
  nothalal_revenue_percent?: number;
  doubtful_revenue_percent?: number;
  exchange?: string;
}

function toInfo(doc: TypesenseDoc): HalalInfo {
  const ticker = (doc.id ?? doc.ticker ?? "").toUpperCase();
  const exchange = doc.exchange ?? "";
  return {
    status: parseRating(doc.musaffaHalalRating ?? doc.sharia_compliance),
    halalPct: doc.halal_revenue_percent ?? 0,
    notHalalPct: doc.nothalal_revenue_percent ?? 0,
    doubtfulPct: doc.doubtful_revenue_percent ?? 0,
    exchange,
    ticker,
    musaffaUrl: ticker && exchange ? musaffaUrl(ticker, exchange) : "",
  };
}

async function searchBatch(keys: string[], apiKey: string): Promise<Record<string, HalalInfo>> {
  const filter = keys.map((k) => `\`${k}\``).join(",");
  const params = new URLSearchParams({
    q: "*",
    filter_by: `id:=[${filter}]`,
    per_page: String(MAX_PER_PAGE),
  });
  const res = await fetch(`${HOST}${SEARCH_PATH}?${params}`, {
    headers: { "x-typesense-api-key": apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status >= 500) {
    throw new MusaffaOutage(`Musaffa ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`Musaffa ${res.status}`);
  }
  const data = (await res.json()) as { hits?: { document?: TypesenseDoc }[] };
  const out: Record<string, HalalInfo> = {};
  for (const hit of data.hits ?? []) {
    const doc = hit.document;
    if (!doc) continue;
    const info = toInfo(doc);
    if (info.ticker) out[info.ticker] = info;
  }
  return out;
}

// Returns a map keyed by uppercased Musaffa `id`. Throws MusaffaOutage on 5xx so
// the caller (halal-fetch) can fail open. Missing keys simply aren't in the map.
export async function fetchMusaffa(keys: string[], apiKey: string): Promise<Record<string, HalalInfo>> {
  if (keys.length === 0) return {};
  const merged: Record<string, HalalInfo> = {};
  for (let i = 0; i < keys.length; i += MAX_PER_PAGE) {
    const chunk = keys.slice(i, i + MAX_PER_PAGE);
    Object.assign(merged, await searchBatch(chunk, apiKey));
  }
  return merged;
}
