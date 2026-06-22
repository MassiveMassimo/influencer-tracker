"use client";

import { useMemo } from "react";
import type { CumPoint } from "#/lib/types.ts";
import { AreaChart } from "./area-chart";
import { chartCssVars, useChartStable, useYScale } from "./chart-context";
import { Grid } from "./grid";
import { ProfitLossArea } from "./profit-loss-area";
import { ReferenceArea } from "./reference-area";
import { ChartTooltip } from "./tooltip/chart-tooltip";
import { XAxis } from "./x-axis";
import { YAxis } from "./y-axis";

// bklit AreaChart rendering of the cumulative-excess-vs-SPY curve. Replaces the
// hand-rolled native SVG so the curve gains a hover tooltip, crosshair, and the
// shell's reveal animation. The sign-split fill-to-zero is `ProfitLossArea` (a
// local fork — bklit has no fill-to-baseline primitive). `cumExcess` always
// starts at v=0 (entry day excess is 0), so the auto y-domain includes the zero
// baseline without an explicit yDomain override (the shell exposes none).
//
// Lazy-loaded by `CumulativeExcess` so motion/@visx/d3 stay off the creator
// route's initial bundle (mirrors the lazy CallFunnel).

const signColor = (v: number) =>
  v >= 0 ? "var(--color-emerald-500)" : "var(--color-rose-500)";

const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

const fmtAxisPct = (v: number) => `${(v * 100).toFixed(0)}%`;

// Always-visible end readout at the last point — preserves the native chart's
// endpoint label. Renders inside the chart SVG via the chart context.
function EndReadout() {
  const { renderData, xScale, xAccessor } = useChartStable();
  const yScale = useYScale();
  const last = renderData.at(-1);
  if (!last) return null;
  const v = last.v as number;
  const cx = xScale(xAccessor(last)) ?? 0;
  const cy = yScale(v) ?? 0;
  const color = signColor(v);
  return (
    <g>
      <circle cx={cx} cy={cy} fill={color} r={3} />
      <text
        className="tabular-nums"
        dy="0.32em"
        fill={color}
        fontSize={11}
        fontWeight={600}
        x={cx + 6}
        y={cy}
      >
        {fmtPct(v)}
      </text>
    </g>
  );
}

// 3-month average readout, pinned to the top-left corner of the ReferenceArea
// band (band starts at `start`). Consumes the chart scale so it tracks the band.
function Avg3mLabel({ avg3m, start }: { avg3m?: number; start?: Date }) {
  const { xScale, innerWidth } = useChartStable();
  if (!start) return null;
  const x = Math.max(0, Math.min(innerWidth, xScale(start) ?? 0)) + 6;
  const hasAvg = avg3m != null && Number.isFinite(avg3m);
  return (
    <text x={x} y={12}>
      <tspan dy="0.85em" fill={chartCssVars.foregroundMuted} fontSize={9} x={x}>
        3m avg
      </tspan>
      {hasAvg ? (
        <tspan
          className="tabular-nums"
          dy="1.3em"
          fill={signColor(avg3m)}
          fontSize={13}
          fontWeight={600}
          x={x}
        >
          {fmtPct(avg3m)}
        </tspan>
      ) : null}
    </text>
  );
}

export function CumExcessArea({ pts, avg3m }: { pts: CumPoint[]; avg3m?: number }) {
  const data = useMemo(
    () => pts.map((p) => ({ date: new Date(`${p.t}T00:00:00Z`), v: p.v })),
    [pts],
  );

  // Start of the most-recent-3-months band: latest data date back 3 months
  // (anchored to the data, not "now", so it stays reproducible). Omitting x2
  // extends the band to the plot's right edge (the latest point).
  const threeMoAgo = useMemo(() => {
    const last = data.at(-1)?.date;
    if (!last) return undefined;
    const d = new Date(last);
    d.setMonth(d.getMonth() - 3);
    return d;
  }, [data]);

  return (
    <AreaChart
      aspectRatio="auto"
      className="h-[200px]"
      data={data}
      margin={{ top: 16, right: 56, bottom: 24, left: 44 }}
    >
      {/* Break-even baseline (== SPY), mirrors the native dashed "0% · SPY" line. */}
      <Grid
        highlightRowStrokeDasharray="3 3"
        highlightRowStrokeOpacity={0.5}
        highlightRowValues={[0]}
        horizontal
      />
      {/* Most-recent-3-months window: calls here haven't fully matured to 3m. */}
      {threeMoAgo ? <ReferenceArea showMarkers strokeStyle="dashed" x1={threeMoAgo} /> : null}
      <ProfitLossArea dataKey="v" />
      <XAxis />
      <YAxis formatValue={fmtAxisPct} numTicks={4} />
      <ChartTooltip
        indicatorColor={(point) => signColor((point.v as number) ?? 0)}
        rows={(point) => {
          const v = (point.v as number) ?? 0;
          return [{ color: signColor(v), label: "Excess vs SPY", value: fmtPct(v) }];
        }}
      />
      <Avg3mLabel avg3m={avg3m} start={threeMoAgo} />
      <EndReadout />
    </AreaChart>
  );
}

export default CumExcessArea;
