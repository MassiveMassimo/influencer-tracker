// The categorical "excess by horizon" bars and the conviction-vs-return scatter
// are simple enough to render natively here.
import { lazy, Suspense } from "react";
import { AreaChartLoading } from "#/components/charts/area-chart-loading";
import type { Dataset, Horizon, CumPoint } from "../lib/types";

// Lazy so the cumulative-excess chart's motion/@visx/d3 deps land in their own
// chunk, off the creator route's initial/hydration path.
const CumExcessArea = lazy(() =>
  import("#/components/charts/cum-excess-area").then((m) => ({ default: m.CumExcessArea })),
);

const HORIZONS: Horizon[] = ["1w", "1m", "3m", "toDate"];
const HLABEL: Record<Horizon, string> = { "1w": "1w", "1m": "1m", "3m": "3m", toDate: "to date" };

function excessRows(ds: Dataset) {
  const sc = ds.scorecard;
  return HORIZONS.map((h) => ({ label: HLABEL[h], pct: +(sc.avgExcess[h] * 100).toFixed(1) }));
}

function convictionPoints(ds: Dataset) {
  return ds.calls
    .filter((c) => c.returns.toDate.excess != null)
    .map((c) => ({ conviction: c.conviction, excess: +(c.returns.toDate.excess! * 100).toFixed(1) }));
}

// Equal-weight mean excess-vs-SPY of the creator's scored picks over time. 0 =
// matched SPY on average; the endpoint equals avgExcess.toDate. The chart itself
// is the bklit AreaChart (CumExcessArea), lazy-loaded so motion/@visx/d3 stay off
// the route's initial bundle; this wrapper stays dep-free for the guard + caption.
export function CumulativeExcess({ ds }: { ds: Dataset }) {
  const pts: CumPoint[] = ds.scorecard.cumExcess ?? [];
  const nPicks = ds.calls.filter((c) => c.isFirstCall && c.returns.toDate.excess != null).length;
  if (pts.length < 2) {
    return <p className="py-6 text-sm text-muted-foreground">Not enough elapsed calls to chart yet.</p>;
  }
  return (
    <div>
      <Suspense fallback={<AreaChartLoading aspectRatio="auto" className="h-[200px] w-full" label="Loading" />}>
        <CumExcessArea pts={pts} />
      </Suspense>
      <p className="mt-2 text-xs text-muted-foreground">
        Equal-weight across {nPicks} scored {nPicks === 1 ? "pick" : "picks"} · excess return vs SPY, to date
      </p>
    </div>
  );
}

// Native horizontal bars — width proportional to |excess|, colored by sign.
export function HorizonBars({ ds }: { ds: Dataset }) {
  const rows = excessRows(ds);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pct)));
  return (
    <div className="space-y-2 py-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <div className="w-16 shrink-0 text-muted-foreground">{r.label}</div>
          <div className="relative h-5 flex-1 rounded bg-muted/50">
            <div
              className={`absolute inset-y-0 rounded ${r.pct >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-rose-500"}`}
              style={{ width: `${(Math.abs(r.pct) / max) * 50}%` }}
            />
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
          </div>
          <div className={`w-14 shrink-0 text-right tabular-nums ${r.pct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {r.pct > 0 ? "+" : ""}{r.pct}%
          </div>
        </div>
      ))}
    </div>
  );
}

// Native SVG scatter: x = conviction (0..1), y = excess return (%).
export function ConvictionScatter({ ds }: { ds: Dataset }) {
  const points = convictionPoints(ds);
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">No elapsed calls yet.</p>;
  }
  const W = 320, H = 160, P = 28;
  const maxAbs = Math.max(5, ...points.map((p) => Math.abs(p.excess)));
  const x = (c: number) => P + c * (W - 2 * P);
  const y = (e: number) => H / 2 - (e / maxAbs) * (H / 2 - P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="conviction vs excess return">
      <line x1={P} y1={H / 2} x2={W - P} y2={H / 2} className="stroke-border" strokeDasharray="3 3" />
      <text x={4} y={H / 2 + 3} className="fill-muted-foreground" fontSize="9">0%</text>
      <text x={P} y={H - 6} className="fill-muted-foreground" fontSize="9">low conviction</text>
      <text x={W - P} y={H - 6} textAnchor="end" className="fill-muted-foreground" fontSize="9">high</text>
      {points.map((p, i) => (
        <circle key={i} cx={x(p.conviction)} cy={y(p.excess)} r={4}
          className={p.excess >= 0 ? "fill-emerald-500" : "fill-rose-500"} fillOpacity={0.8} />
      ))}
    </svg>
  );
}
