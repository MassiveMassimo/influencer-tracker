// Funnel uses the bklit FunnelChart; the categorical "excess by horizon" bars and
// the conviction-vs-return scatter are simple enough to render natively here.
import { FunnelChart } from "#/components/charts/funnel-chart";
import type { Dataset, Horizon, CumPoint } from "../lib/types";

// Pinned en-US/UTC so SSR and client format identically (avoids hydration #418).
function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

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

// Call funnel — used in the overview side pane. Wrap in ChartBoundary at call site.
export function CallFunnel({ ds }: { ds: Dataset }) {
  const funnel = ds.scorecard.funnel;
  // The first stage is reels (reach) — a post-level count. For multi-ticker creators one
  // reel names several stocks, so the ticker-level stages below are wider: that is not a
  // funnel. Render the call-level conversion (stages 2..n, monotonic by construction:
  // stocks named ⊇ bullish buys ⊇ unique positions ⊇ beat SPY) and surface reels as
  // reach context above it.
  const reels = funnel?.[0];
  const stages = funnel?.slice(1) ?? [];
  const top = stages[0]?.value ?? 0;
  // Guard only genuinely degenerate data: empty, a zero top stage (every downstream % would
  // divide by zero → NaN%/Infinity%), or a stage wider than the top (corrupted re-score).
  if (stages.length === 0 || top <= 0 || stages.some((s) => !Number.isFinite(s.value) || s.value > top)) {
    return <p className="text-sm text-muted-foreground">Not enough calls to chart yet.</p>;
  }
  return (
    <div className="space-y-2">
      {reels && reels.value > 0 && (
        <p className="text-xs text-muted-foreground">
          From {reels.value.toLocaleString()} {reels.label.replace(/\s*\(12mo\)$/, "")} tracked over 12 months
        </p>
      )}
      {/* Vertical: longer stage labels get a full-width row instead of colliding in cells. */}
      <FunnelChart
        data={stages}
        color="var(--chart-1)"
        layers={3}
        orientation="vertical"
        labelLayout="grouped"
        labelOrientation="horizontal"
      />
    </div>
  );
}

// Native SVG area chart: equal-weight mean excess-vs-SPY of the creator's scored
// picks over time. 0 = matched SPY on average; the endpoint equals avgExcess.toDate.
export function CumulativeExcess({ ds }: { ds: Dataset }) {
  const pts: CumPoint[] = ds.scorecard.cumExcess ?? [];
  const nPicks = ds.calls.filter((c) => c.isFirstCall && c.returns.toDate.excess != null).length;
  if (pts.length < 2) {
    return <p className="py-6 text-sm text-muted-foreground">Not enough elapsed calls to chart yet.</p>;
  }
  const W = 640, H = 200, PL = 16, PR = 52, PT = 16, PB = 22;
  const first = pts[0]!, last = pts[pts.length - 1]!;
  const vs = pts.map((p) => p.v);
  const hi = Math.max(0, ...vs), lo = Math.min(0, ...vs);
  const pad = (hi - lo) * 0.1 || 0.01;
  const hiP = hi + pad, loP = lo - pad;
  const t0 = Date.parse(first.t), tSpan = Date.parse(last.t) - t0 || 1;
  const x = (t: string) => PL + ((Date.parse(t) - t0) / tSpan) * (W - PL - PR);
  const y = (v: number) => PT + ((hiP - v) / (hiP - loP)) * (H - PT - PB);
  const up = last.v >= 0;
  const stroke = up ? "stroke-emerald-500" : "stroke-rose-500";
  const fill = up ? "fill-emerald-500" : "fill-rose-500";
  const tone = up ? "fill-emerald-600 dark:fill-emerald-400" : "fill-rose-600 dark:fill-rose-400";
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(last.t).toFixed(1)},${y(0).toFixed(1)} L${x(first.t).toFixed(1)},${y(0).toFixed(1)} Z`;
  const endPct = `${last.v > 0 ? "+" : ""}${(last.v * 100).toFixed(1)}%`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Cumulative excess return vs SPY, currently ${endPct}`}>
        {/* zero baseline = matches SPY */}
        <line x1={PL} y1={y(0)} x2={W - PR} y2={y(0)} className="stroke-border" strokeDasharray="3 3" />
        <text x={PL} y={y(0) - 4} className="fill-muted-foreground" fontSize="9">0% · SPY</text>
        <path d={area} className={fill} fillOpacity={0.12} />
        <path d={line} className={stroke} fill="none" strokeWidth={1.75}
          strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last.v)} r={3} className={fill} />
        <text x={x(last.t) + 6} y={y(last.v) + 3} className={`${tone} tabular-nums`}
          fontSize="11" fontWeight="600">{endPct}</text>
        <text x={PL} y={H - 6} className="fill-muted-foreground" fontSize="9">{fmtDate(first.t)}</text>
        <text x={W - PR} y={H - 6} textAnchor="end" className="fill-muted-foreground" fontSize="9">{fmtDate(last.t)}</text>
      </svg>
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
