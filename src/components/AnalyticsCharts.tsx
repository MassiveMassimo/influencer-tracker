// The "excess by horizon" and "avg excess by conviction" panels render as the
// shared CategoryBars chart; the cumulative-excess curve is the bklit AreaChart.
import { lazy, Suspense } from "react";
import { AreaChartLoading } from "#/components/charts/area-chart-loading";
import { ChartHandoff, useChunkReady } from "#/components/charts/chart-handoff";
import type { CategoryBarRow } from "#/components/charts/category-bars";
import type { CreatorConvictionRow } from "#/lib/creator-data";
import type { CumPoint, Horizon, Scorecard } from "../lib/types";

// Lazy so the charts' motion/@visx/d3 deps land in their own chunk, off the
// creator route's initial/hydration path. Named importers (not inline) so the
// same loader feeds both React.lazy and useChunkReady (one shared import).
const importCumExcess = () =>
  import("#/components/charts/cum-excess-area").then((m) => ({ default: m.CumExcessArea }));
const importCategoryBars = () =>
  import("#/components/charts/category-bars").then((m) => ({ default: m.CategoryBars }));
const CumExcessArea = lazy(importCumExcess);
const CategoryBars = lazy(importCategoryBars);

const HORIZONS: Horizon[] = ["1w", "1m", "3m", "toDate"];
const HLABEL: Record<Horizon, string> = { "1w": "1w", "1m": "1m", "3m": "3m", toDate: "to date" };

// Skeleton matching CategoryBars' row layout while its motion chunk loads.
function BarsFallback({ rows }: { rows: number }) {
  return (
    <div className="space-y-2.5 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="flex items-center gap-3" key={i}>
          <div className="h-3 w-32 shrink-0 rounded bg-muted/50" />
          <div className="h-5 flex-1 rounded bg-muted/50" />
        </div>
      ))}
    </div>
  );
}

// Equal-weight mean excess-vs-SPY of the creator's scored picks over time. 0 =
// matched SPY on average; the endpoint equals avgExcess.toDate. The chart itself
// is the bklit AreaChart (CumExcessArea), lazy-loaded so motion/@visx/d3 stay off
// the route's initial bundle; this wrapper stays dep-free for the guard + caption.
export function CumulativeExcess({ scorecard, nPicks }: { scorecard: Scorecard; nPicks: number }) {
  const pts: CumPoint[] = scorecard.cumExcess ?? [];
  const ready = useChunkReady(importCumExcess);
  if (pts.length < 2) {
    return (
      <p className="py-6 text-sm text-muted-foreground">Not enough elapsed calls to chart yet.</p>
    );
  }
  return (
    <div>
      <ChartHandoff
        className="h-[200px]"
        loading={!ready}
        skeleton={
          <AreaChartLoading aspectRatio="auto" className="h-[200px] w-full" label="Loading" />
        }
      >
        <Suspense fallback={null}>
          <CumExcessArea pts={pts} />
        </Suspense>
      </ChartHandoff>
      <p className="mx-auto mt-2 max-w-6xl px-4 text-xs text-muted-foreground md:px-16">
        Equal-weight across {nPicks} scored {nPicks === 1 ? "pick" : "picks"} ·
        <br className="md:hidden" /> excess return vs SPY, to date
      </p>
    </div>
  );
}

// Avg excess vs SPY at each forward horizon — the maturity ramp.
export function HorizonBars({ scorecard }: { scorecard: Scorecard }) {
  const rows: CategoryBarRow[] = HORIZONS.map((h) => ({
    key: h,
    label: HLABEL[h],
    value: scorecard.avgExcess[h],
  }));
  const ready = useChunkReady(importCategoryBars);
  return (
    <ChartHandoff loading={!ready} skeleton={<BarsFallback rows={rows.length} />}>
      <Suspense fallback={null}>
        <CategoryBars rows={rows} transitionKey="horizon-bars" />
      </Suspense>
    </ChartHandoff>
  );
}

// Avg excess vs SPY by conviction bucket — does conviction pay off?
export function ConvictionBars({ rows }: { rows: CreatorConvictionRow[] }) {
  const ready = useChunkReady(importCategoryBars);
  if (rows.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">No elapsed calls yet.</p>;
  }
  return (
    <ChartHandoff loading={!ready} skeleton={<BarsFallback rows={rows.length} />}>
      <Suspense fallback={null}>
        <CategoryBars rows={rows} transitionKey="conviction-bars" />
      </Suspense>
    </ChartHandoff>
  );
}
