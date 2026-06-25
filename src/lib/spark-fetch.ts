import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve.ts";
import { parseSparkResponse, type Spark1D } from "./spark-parse.ts";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: Record<string, Spark1D> }>();

const InputSchema = z.object({
  symbols: z.array(z.string().min(1).max(40)).max(50),
});

// Yahoo's spark endpoint rejects requests of >20 symbols (400 Bad Request), so
// fan the set into ≤20-symbol chunks fetched in parallel.
const YH_MAX = 20;

async function fetchSparkChunk(group: string[]): Promise<Record<string, Spark1D>> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(group.join(","))}&range=1d&interval=5m&indicators=close`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`spark: ${res.status}`);
    return parseSparkResponse(await res.json());
  } catch (err) {
    // Per-chunk fail-open: one bad chunk shouldn't blank the others.
    console.warn("[fetch1DSparks] chunk failed:", (err as Error)?.message ?? err);
    return {};
  }
}

// Batched 1D intraday sparks for the rail. ≤20 symbols per upstream request
// (Yahoo's cap), merged; 5-min cache keyed by the sorted symbol set.
export const fetch1DSparks = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<Record<string, Spark1D>> => {
    const symbols = [...new Set(data.symbols.map((s) => s.toUpperCase()))]
      .filter(isSafeAssetKey)
      .sort();
    if (symbols.length === 0) return {};

    const key = symbols.join(",");
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at <= TTL_MS) return hit.data;

    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += YH_MAX) chunks.push(symbols.slice(i, i + YH_MAX));
    const parsed = Object.assign({}, ...(await Promise.all(chunks.map(fetchSparkChunk))));
    cache.set(key, { at: now, data: parsed });
    return parsed;
  });
