import { queryOptions } from "@tanstack/react-query";
import type { Timeframe } from "./window-series.ts";
import { fetchChart, type ChartData } from "./chart-fetch.ts";

// Shared by the route loader (ensureQueryData, SSR prefetch) and the component
// (useQuery). Same key + queryFn => SSR data is reused without a refetch.
export function chartQuery(symbol: string, timeframe: Timeframe, firstDate: string) {
  return queryOptions<ChartData>({
    queryKey: ["chart", symbol, timeframe],
    queryFn: () => fetchChart({ data: { symbol, timeframe, firstDate } }),
    staleTime: 5 * 60 * 1000,
  });
}
