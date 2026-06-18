import * as React from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchHalal } from "./halal-fetch.ts";
import { type HalalInfo } from "./halal/types.ts";
import { usePreferences } from "./preferences.tsx";

const STALE_MS = 12 * 60 * 60 * 1000; // 12h — real client-side reuse lives here
const GC_MS = 24 * 60 * 60 * 1000;

export function halalQuery(symbols: string[]) {
  const sorted = [...new Set(symbols)].sort();
  return queryOptions<Record<string, HalalInfo>>({
    queryKey: ["halal", sorted],
    queryFn: () => fetchHalal({ data: { symbols: sorted } }),
    staleTime: STALE_MS,
    gcTime: GC_MS,
  });
}

// Returns a lookup fn. Disabled (no network) unless the opt-in toggle is on.
export function useHalalStatus(symbols: string[]): (symbol: string) => HalalInfo | undefined {
  const { showHalalStatus } = usePreferences();
  const key = symbols.join(",");
  const sorted = React.useMemo(() => [...new Set(symbols)].sort(), [key]);
  const q = useQuery({
    ...halalQuery(sorted),
    enabled: showHalalStatus && sorted.length > 0,
  });
  return React.useCallback((symbol: string) => q.data?.[symbol], [q.data]);
}
