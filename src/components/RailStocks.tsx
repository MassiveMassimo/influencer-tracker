import { useDeferredValue, useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "./ui/scroll-area";
import { RailNavList } from "./RailNavList";
import { Sparkline } from "./Sparkline";
import { sparks1dQuery } from "#/lib/spark-query.ts";
import { useHalalStatus } from "#/lib/halal-query.ts";
import { HalalBadge } from "#/components/halal/halal-badge.tsx";
import { fetchCallsIndex } from "#/lib/data.ts";
import { topStocksByLastCall, type RailStock } from "#/lib/rail-stocks.ts";

function pctChip(changePct: number | null) {
  if (changePct == null)
    return <span className="font-mono text-[10px] text-muted-foreground tabular-nums">—</span>;
  const cls =
    changePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <span className={`font-mono text-[10px] tabular-nums ${cls}`}>
      {changePct >= 0 ? "+" : ""}
      {(changePct * 100).toFixed(1)}%
    </span>
  );
}

// Rail Stocks list: static rows from the loader; 1D sparklines lazy-fetched in one
// batched query (does not block SSR). Own lina ScrollArea so it scrolls
// independently of the Creators list.
export function RailStocks({
  stocks,
  onNavigate,
  query = "",
  searchOpen = false,
  activeIndex = -1,
  setActiveIndex,
  onSelect,
}: {
  stocks: RailStock[];
  onNavigate?: () => void;
  query?: string;
  searchOpen?: boolean;
  activeIndex?: number;
  setActiveIndex?: (i: number) => void;
  onSelect?: () => void;
}) {
  // Full ticker universe for search — lazily fetched only once search is opened,
  // reusing the CDN-cached calls-index /explore already loads. No added payload
  // on a normal page view.
  const { data: fullIndex } = useQuery({
    queryKey: ["rail-calls-index"],
    queryFn: fetchCallsIndex,
    staleTime: 60 * 60 * 1000,
    enabled: searchOpen,
  });
  const allStocks = useMemo(
    () => (fullIndex ? topStocksByLastCall(fullIndex, Number.POSITIVE_INFINITY) : stocks),
    [fullIndex, stocks],
  );

  const q = query.trim().toLowerCase();
  // Default view = top-20; searching filters the full universe (capped to 50 rows).
  const shown = useMemo(
    () =>
      q
        ? allStocks
            .filter(
              (s) => s.symbol.toLowerCase().includes(q) || s.company.toLowerCase().includes(q),
            )
            .slice(0, 50)
        : stocks,
    [q, allStocks, stocks],
  );

  // Sparks + halal for whatever rows are actually shown — so searched results get a
  // chart, % and halal badge too, not just the default top-20. Deferred so fast
  // typing coalesces into one fetch each instead of one per keystroke. Fail-open:
  // a symbol with no upstream data just renders no chart / no badge.
  const shownSymbols = useMemo(() => shown.map((s) => s.symbol), [shown]);
  const deferredSymbols = useDeferredValue(shownSymbols);
  const { data, isLoading } = useQuery(sparks1dQuery(deferredSymbols));
  // Opt-in halal badge (renders null when the toggle is off / symbol unrated).
  const getHalal = useHalalStatus(deferredSymbols);
  // Treat the deferral gap as loading too, so a new row shows the skeleton instead
  // of flashing empty before its fetch starts.
  const sparksLoading = isLoading || shownSymbols !== deferredSymbols;

  // Active-route slug for the NavMenu pill (matched against each item's slug).
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeSymbol = pathname.match(/^\/t\/([^/]+)/)?.[1] ?? null;
  const stocksActive = activeSymbol ? `t:${activeSymbol}` : null;

  if (stocks.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-muted-foreground/60">No stocks yet</div>;
  }

  // FF scroll-area wraps children in Base UI ScrollArea.Content (inline
  // min-width: fit-content), which forces a stray horizontal scroll on this
  // vertical list; pin the Content to the viewport width so rows truncate.
  return (
    <ScrollArea
      className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>*]:min-w-0!"
      viewportClassName="overscroll-contain px-2 pb-2 scroll-fade"
    >
      <RailNavList
        items={shown}
        getKey={(s) => s.symbol}
        section="stocks"
        navAriaLabel="Stocks navigation"
        listAriaLabel="Stocks"
        activeSlug={stocksActive}
        searchOpen={searchOpen}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        getSlug={(s) => `t:${s.symbol}`}
        getLinkProps={(s) => ({
          to: "/t/$symbol/$creator",
          params: { symbol: s.symbol, creator: "all" },
        })}
        getItemClassName={() => "gap-2 px-2 py-1.5"}
        onRowClick={() => {
          onNavigate?.();
          onSelect?.();
        }}
        emptyText="No matches"
        renderRow={(s) => {
          const spark = data?.[s.symbol];
          return (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm font-medium text-foreground">{s.symbol}</span>
                  <HalalBadge info={getHalal(s.symbol)} />
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{s.company}</div>
              </div>
              {spark ? (
                <Sparkline closes={spark.closes} excess={spark.changePct} width={48} height={18} />
              ) : sparksLoading ? (
                // Sparks for the shown set are still fetching — skeleton.
                <span className="block h-[18px] w-12 animate-pulse rounded bg-foreground/[0.06]" />
              ) : (
                // Settled with no data for this symbol (Yahoo gap) — render nothing.
                <span className="block h-[18px] w-12" />
              )}
              <span className="w-10 text-right">{pctChip(spark?.changePct ?? null)}</span>
            </>
          );
        }}
      />
    </ScrollArea>
  );
}
