import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "./ui/scroll-area";
import { Sparkline } from "./Sparkline";
import { sparks1dQuery } from "#/lib/spark-query.ts";
import type { RailStock } from "#/lib/rail-stocks.ts";

function pctChip(changePct: number | null) {
  if (changePct == null) return <span className="font-mono text-[10px] text-muted-foreground tabular-nums">—</span>;
  const cls = changePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <span className={`font-mono text-[10px] tabular-nums ${cls}`}>
      {changePct >= 0 ? "+" : ""}{(changePct * 100).toFixed(1)}%
    </span>
  );
}

// Rail Stocks list: static rows from the loader; 1D sparklines lazy-fetched in one
// batched query (does not block SSR). Own lina ScrollArea so it scrolls
// independently of the Creators list.
export function RailStocks({ stocks, onNavigate }: { stocks: RailStock[]; onNavigate?: () => void }) {
  const symbols = stocks.map((s) => s.symbol);
  const { data } = useQuery(sparks1dQuery(symbols));

  if (stocks.length === 0) {
    return <div className="px-2 py-1.5 text-muted-foreground/60 text-xs">No stocks yet</div>;
  }

  return (
    <ScrollArea
      className="min-h-0 flex-1"
      viewportClassName="px-2 pb-2"
      scrollbarClassName="w-1.5"
      maskColor="color-mix(in oklab, var(--color-foreground) 2%, var(--color-background))"
    >
      <ul className="flex flex-col gap-0.5">
        {stocks.map((s) => {
          const spark = data?.[s.symbol];
          return (
            <li key={s.symbol}>
              <Link
                to="/t/$symbol/$creator"
                params={{ symbol: s.symbol, creator: "all" }}
                onClick={onNavigate}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 no-underline transition-colors hover:bg-foreground/[0.03]"
                activeProps={{ className: "flex w-full items-center gap-2 rounded-md px-2 py-1.5 bg-foreground/[0.06] no-underline" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm text-foreground">{s.symbol}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{s.company}</div>
                </div>
                {spark ? (
                  <Sparkline closes={spark.closes} excess={spark.changePct} width={48} height={18} />
                ) : (
                  <span className="block h-[18px] w-12 animate-pulse rounded bg-foreground/[0.06]" />
                )}
                <span className="w-10 text-right">{pctChip(spark?.changePct ?? null)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
