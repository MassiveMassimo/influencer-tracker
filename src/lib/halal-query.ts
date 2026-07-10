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

// SSR-only loader prefetch: bakes halal data into the dehydrated first paint and the
// ISR-cached HTML, so once an opted-in viewer's preference hydrates, the query cache is
// already warm — no post-hydration Musaffa round trip, no ~620ms pop-in. Runs
// unconditionally on SSR (the opt-in preference is client-only — localStorage, stripped
// by the ISR edge cache — so the server can't know it; the ISR layer amortizes the fetch
// to once per page, not per visit). Skipped on client navigations (window defined): there
// useHalalStatus fetches lazily, only when the toggle is on. Fail-open (fetchHalal never
// throws).
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
  // `symbols` is a fresh array each render; `key` is its stable content signature,
  // so the dedupe+sort recomputes only when the tickers actually change.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const sorted = React.useMemo(() => [...new Set(symbols)].sort(), [key]);
  const q = useQuery({
    ...halalQuery(sorted),
    enabled: showHalalStatus && sorted.length > 0,
  });
  return React.useCallback((symbol: string) => q.data?.[symbol] ?? UNKNOWN_INFO, [q.data]);
}
