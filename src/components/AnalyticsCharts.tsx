// bklit's Bar/Scatter/Line/Candlestick are time-series charts (x must be a Date).
// Only Gauge and Funnel suit non-time analytics, so the categorical "excess by
// horizon" and the conviction-vs-return scatter are rendered natively here.
import { Gauge } from "#/components/charts/gauge";
import { FunnelChart } from "#/components/charts/funnel-chart";
import { LOW_CONFIDENCE_N } from "#/lib/scorecard.ts";
import type { Dataset, Horizon } from "../lib/types";

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

// Hit-rate gauge — used in the overview featured pane. Wrap in ChartBoundary at call site.
export function HitRateGauge({ ds }: { ds: Dataset }) {
  const sc = ds.scorecard;
  const n = sc.hitRateN["3m"];
  const beats = Math.round(sc.hitRate["3m"] * n);
  return (
    <div>
      <Gauge
        value={Math.round(sc.hitRate["3m"] * 100)}
        centerValue={sc.hitRate["3m"]}
        defaultLabel="beat SPY"
        inactiveFillOpacity={0.4}
        formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
      />
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {beats} of {n} first calls · 3m
        {n < LOW_CONFIDENCE_N && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">· low confidence</span>
        )}
      </p>
    </div>
  );
}

// Call funnel — used in the overview side pane. Wrap in ChartBoundary at call site.
export function CallFunnel({ ds }: { ds: Dataset }) {
  const sc = ds.scorecard;
  if (!sc.funnel || sc.funnel.length === 0) {
    return <p className="text-sm text-muted-foreground">Run the full pipeline to populate.</p>;
  }
  // Vertical: 5 longer stage labels get their own full-width row instead of
  // colliding inside narrow horizontal cells.
  return (
    <FunnelChart
      data={sc.funnel}
      color="var(--chart-1)"
      layers={3}
      orientation="vertical"
      labelLayout="grouped"
      labelOrientation="horizontal"
    />
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
