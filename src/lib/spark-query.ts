import { queryOptions } from "@tanstack/react-query";
import { fetch1DSparks } from "./spark-fetch.ts";
import type { Spark1D } from "./spark-parse.ts";

// One batched query for all rail sparklines. Disabled until symbols are known so
// SSR/first paint never waits on it. Keyed by the sorted set so the cache is
// shared regardless of input order.
export function sparks1dQuery(symbols: string[]) {
  const sorted = [...symbols].sort();
  return queryOptions<Record<string, Spark1D>>({
    queryKey: ["sparks1d", sorted],
    queryFn: () => fetch1DSparks({ data: { symbols: sorted } }),
    staleTime: 2 * 60 * 1000,
    enabled: sorted.length > 0,
  });
}
