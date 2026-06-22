import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isSafeAssetKey } from "./api-serve.ts";
import { parseSparkResponse, type Spark1D } from "./spark-parse.ts";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: Record<string, Spark1D> }>();

const InputSchema = z.object({
  symbols: z.array(z.string().min(1).max(40)).max(30),
});

// Batched 1D intraday sparks for the rail. One upstream request to Yahoo's
// multi-symbol spark endpoint; 5-min cache keyed by the sorted symbol set.
// Fail-open: any error returns {} so the rail still renders its static list.
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

    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(key)}&range=1d&interval=5m&indicators=close`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`spark: ${res.status}`);
      const json = await res.json();
      const parsed = parseSparkResponse(json);
      cache.set(key, { at: now, data: parsed });
      return parsed;
    } catch (err) {
      console.warn("[fetch1DSparks] failed, returning empty:", (err as Error)?.message ?? err);
      return {};
    }
  });
