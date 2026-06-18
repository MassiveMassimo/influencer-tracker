import * as React from "react";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { fetchHalal } from "./halal-fetch.ts";
import { type HalalInfo, UNKNOWN_INFO } from "./halal/types.ts";
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

// SSR-only loader prefetch: bakes halal data into the dehydrated first paint so an
// opted-in viewer sees badges on the first client render — no post-hydration round
// trip. Skipped on client navigations (window defined): there useHalalStatus fetches
// lazily and only when the toggle is on, so opted-out users never trigger a request.
// The SSR result is itself ISR-cached, so the Musaffa call is amortized per page, not
// per visit. Fail-open (fetchHalal never throws); the catch is belt-and-suspenders.
export async function prefetchHalal(queryClient: QueryClient, symbols: string[]): Promise<void> {
  if (typeof window !== "undefined" || symbols.length === 0) return;
  await queryClient.ensureQueryData(halalQuery(symbols)).catch(() => undefined);
}

// Returns a lookup fn that fails open: an unfetched/missing symbol resolves to
// UNKNOWN_INFO (which renders nothing), so call sites never coalesce. Disabled
// (no network) unless the opt-in toggle is on.
export function useHalalStatus(symbols: string[]): (symbol: string) => HalalInfo {
  const { showHalalStatus } = usePreferences();
  const key = symbols.join(",");
  const sorted = React.useMemo(() => [...new Set(symbols)].sort(), [key]);
  const q = useQuery({
    ...halalQuery(sorted),
    enabled: showHalalStatus && sorted.length > 0,
  });
  return React.useCallback((symbol: string) => q.data?.[symbol] ?? UNKNOWN_INFO, [q.data]);
}
