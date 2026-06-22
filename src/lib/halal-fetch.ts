import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve.ts";
import { type HalalInfo, UNKNOWN_INFO, musaffaKey } from "./halal/types.ts";
import { fetchMusaffa, MusaffaOutage } from "./halal/musaffa.ts";

// --- Best-effort in-memory dedup cache (per warm server instance) ----------
// Mirrors chart-fetch.ts: collapses repeated/concurrent hits within one warm
// instance. NOT durable on Vercel Fluid (evaporates on cold start) — real reuse
// is the client TanStack Query staleTime (halal-query.ts).
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, { at: number; info: HalalInfo }>();

export function cacheGet(key: string, now: number): HalalInfo | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.info;
}

export function cacheSet(key: string, info: HalalInfo, now: number): void {
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: now, info });
}

export function assembleHalal(
  symbols: string[],
  byKey: Record<string, HalalInfo>,
): Record<string, HalalInfo> {
  const out: Record<string, HalalInfo> = {};
  for (const sym of symbols) {
    out[sym] = byKey[musaffaKey(sym)] ?? UNKNOWN_INFO;
  }
  return out;
}

const InputSchema = z.object({
  symbols: z.array(z.string().min(1).max(40)).max(2000),
});

export const fetchHalal = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<Record<string, HalalInfo>> => {
    const { symbols } = data;
    const apiKey = process.env.MUSAFFA_API_KEY;
    if (!apiKey) {
      console.warn("[halal] MUSAFFA_API_KEY unset — returning unknown for all symbols");
      return Object.fromEntries(symbols.map((s) => [s, UNKNOWN_INFO]));
    }

    // Dedupe keys, drop anything that isn't a safe token before it reaches the
    // backtick-quoted filter_by (injection guard, same allowlist as the chart path).
    const keys = [...new Set(symbols.map(musaffaKey))].filter(isSafeAssetKey);

    const now = Date.now();
    const byKey: Record<string, HalalInfo> = {};
    const misses: string[] = [];
    for (const k of keys) {
      const hit = cacheGet(k, now);
      if (hit) byKey[k] = hit;
      else misses.push(k);
    }

    try {
      if (misses.length) {
        const fetched = await fetchMusaffa(misses, apiKey);
        for (const k of misses) {
          // Cache a found record; cache misses as UNKNOWN so we don't re-hit
          // Musaffa for an unlisted ticker every render within the TTL.
          const info = fetched[k] ?? UNKNOWN_INFO;
          cacheSet(k, info, now);
          byKey[k] = info;
        }
      }
    } catch (err) {
      const why = err instanceof MusaffaOutage ? "outage" : "error";
      console.warn(`[halal] Musaffa ${why}, failing open:`, (err as Error)?.message ?? err);
      return Object.fromEntries(symbols.map((s) => [s, UNKNOWN_INFO]));
    }

    return assembleHalal(symbols, byKey);
  });
