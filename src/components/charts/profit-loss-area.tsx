"use client";

import { curveLinear } from "@visx/curve";
import { AreaClosed, LinePath } from "@visx/shape";
import { useId } from "react";
import { useChartStable, useYScale } from "./chart-context";

// Sign-split filled area: fills between the series and a baseline (default 0),
// green above the baseline and red below. Forked from the synced bklit `Area`
// rather than patching it, because bklit's `Area`/`MorphArea` close the fill at
// the chart floor (visx `AreaClosed` defaults y0 to the bottom of the y-range,
// `MorphArea` hardcodes `.y0(innerHeight)`) and expose no baseline prop. A
// cumulative-excess-vs-SPY curve crosses zero, so the fill must close at
// `yScale(0)`. Lives in its own file so a `@bklit` chart re-sync never clobbers
// it. Consumes the same chart context as `Area`, so it registers as a series
// (y-domain + tooltip) via `extractAreaConfigs` and reveals with the shell clip.
//
// The two-tone split is a single vertical gradient with a hard stop at the
// baseline pixel (userSpaceOnUse, tied to `zeroY` not the path bbox): pixels
// above the baseline only ever sit in the green band, pixels below in the red
// band — so one `AreaClosed` paints both regions correctly.

export interface ProfitLossAreaProps {
  /** Key in data for y values. */
  dataKey: string;
  /** Y-scale group id. Default: primary axis. */
  yAxisId?: string | number;
  /** Value the fill closes to and the color flips at. Default: 0. */
  baseline?: number;
  /** Fill color/opacity for values at or above the baseline. */
  positiveColor?: string;
  /** Fill color/opacity for values below the baseline. */
  negativeColor?: string;
  /** Fill opacity of both bands. Default: 0.12 (matches the prior native chart). */
  fillOpacity?: number;
  /** Stroke width. Default: 1.75. */
  strokeWidth?: number;
}

export function ProfitLossArea({
  dataKey,
  yAxisId,
  baseline = 0,
  positiveColor = "var(--color-emerald-500)",
  negativeColor = "var(--color-rose-500)",
  fillOpacity = 0.12,
  strokeWidth = 1.75,
}: ProfitLossAreaProps) {
  const { renderData, xScale, innerHeight, xAccessor } = useChartStable();
  const yScale = useYScale(yAxisId);

  const uid = useId();
  const fillId = `pnl-area-fill-${dataKey}-${uid}`;
  const strokeId = `pnl-area-stroke-${dataKey}-${uid}`;

  // Baseline pixel, clamped into the plot so an entirely one-sided series still
  // closes to an edge (all-positive → floor, all-negative → top).
  const rawZero = yScale(baseline) ?? innerHeight;
  const zeroY = Math.max(0, Math.min(innerHeight, rawZero));
  const zeroFrac = innerHeight > 0 ? zeroY / innerHeight : 1;

  const x = (d: Record<string, unknown>) => xScale(xAccessor(d)) ?? 0;
  const getY = (d: Record<string, unknown>) => {
    const value = d[dataKey];
    return typeof value === "number" ? (yScale(value) ?? 0) : 0;
  };

  return (
    <>
      <defs>
        {/* Hard stop at the baseline pixel: green band above, red band below. */}
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={fillId}
          x1={0}
          x2={0}
          y1={0}
          y2={innerHeight}
        >
          <stop offset={0} stopColor={positiveColor} stopOpacity={fillOpacity} />
          <stop offset={zeroFrac} stopColor={positiveColor} stopOpacity={fillOpacity} />
          <stop offset={zeroFrac} stopColor={negativeColor} stopOpacity={fillOpacity} />
          <stop offset={1} stopColor={negativeColor} stopOpacity={fillOpacity} />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={strokeId}
          x1={0}
          x2={0}
          y1={0}
          y2={innerHeight}
        >
          <stop offset={0} stopColor={positiveColor} />
          <stop offset={zeroFrac} stopColor={positiveColor} />
          <stop offset={zeroFrac} stopColor={negativeColor} />
          <stop offset={1} stopColor={negativeColor} />
        </linearGradient>
      </defs>

      <AreaClosed
        curve={curveLinear}
        data={renderData}
        fill={`url(#${fillId})`}
        x={x}
        y={getY}
        y0={zeroY}
        yScale={yScale}
      />
      <LinePath
        curve={curveLinear}
        data={renderData}
        fill="none"
        stroke={`url(#${strokeId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        x={x}
        y={getY}
      />
    </>
  );
}

ProfitLossArea.displayName = "ProfitLossArea";

export default ProfitLossArea;
