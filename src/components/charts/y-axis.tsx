"use client";

import { chartCssVars, useChart } from "./chart-context";

export interface YAxisProps {
  /** Number of ticks. Aligns with Grid's numTicksRows so labels sit on gridlines. Default: 5 */
  numTicks?: number;
  /** Value formatter. Default: USD price, decimals chosen from the axis magnitude. */
  format?: (value: number) => string;
}

// Pick decimals once from the largest tick so every label on the axis shares a
// format (mixing "$60" and "$60.00" reads as noise). >=100 → whole dollars,
// >=1 → cents, sub-dollar → 4 places for penny stocks.
function makeFormat(ticks: number[]): (value: number) => string {
  const max = ticks.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const decimals = max >= 100 ? 0 : max >= 1 ? 2 : 4;
  return (v) =>
    `$${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// Price labels for the linear y-scale, right-aligned into the chart's right
// margin gutter (candles never draw there, so no overlap). Tick values come
// from yScale.ticks(numTicks) — the same values @visx GridRows uses — so labels
// land exactly on the horizontal gridlines.
export function YAxis({ numTicks = 5, format }: YAxisProps) {
  const { yScale, innerWidth, margin } = useChart();
  const ticks = yScale.ticks(numTicks);
  const fmt = format ?? makeFormat(ticks);

  return (
    <g className="chart-y-axis" aria-hidden="true">
      {ticks.map((v) => {
        const y = yScale(v);
        if (y == null || !Number.isFinite(y)) {
          return null;
        }
        return (
          <text
            key={v}
            className="tabular-nums"
            dy="0.32em"
            fill={chartCssVars.label}
            fontSize={11}
            textAnchor="end"
            x={innerWidth + margin.right - 4}
            y={y}
          >
            {fmt(v)}
          </text>
        );
      })}
    </g>
  );
}

YAxis.displayName = "YAxis";

export default YAxis;
