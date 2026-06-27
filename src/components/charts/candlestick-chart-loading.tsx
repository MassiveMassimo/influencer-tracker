"use client";

import { useMemo } from "react";
import { cn } from "#/lib/utils.ts";
import { Candlestick } from "./candlestick";
import { CandlestickChart, type OHLCDataPoint } from "./candlestick-chart";
import type { Margin } from "./chart-context";
import { ChartLoadingLabel } from "./chart-loading-label";
import { Grid } from "./grid";

const DEFAULT_LOADING_GRID_STROKE = "color-mix(in oklch, var(--chart-grid) 50%, transparent)";
const DEFAULT_LOADING_GRID_SHIMMER_STROKE =
  "color-mix(in oklch, var(--foreground) 68%, transparent)";
// Neutral skeleton candles — no green/red, so the shimmer reads as the motion.
const DEFAULT_CANDLE_FILL = "color-mix(in oklch, var(--foreground) 16%, transparent)";
const SKELETON_POINT_COUNT = 14;

/** Placeholder OHLC candles for the loading skeleton (mirrors generate-chart-skeleton-data). */
function generateCandleSkeletonData(): OHLCDataPoint[] {
  const baseDate = new Date("2025-01-01");
  return Array.from({ length: SKELETON_POINT_COUNT }, (_, i) => {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + i);
    const mid = 110 + Math.sin(i * 0.9) * 30 + i * 4;
    const spread = 10 + Math.abs(Math.sin(i * 1.7)) * 14;
    const open = mid - Math.sin(i * 1.3) * spread * 0.4;
    const close = mid + Math.cos(i * 1.1) * spread * 0.4;
    return {
      date,
      open,
      high: Math.max(open, close) + spread * 0.5,
      low: Math.min(open, close) - spread * 0.5,
      close,
    };
  });
}

export interface CandlestickChartLoadingProps {
  /** Chart margins */
  margin?: Partial<Margin>;
  /** Fill for the neutral skeleton candles. */
  candleFill?: string;
  /** Grid line stroke (color and opacity via color-mix or oklch alpha). */
  gridStroke?: string;
  /** Shimmer band stroke (color and opacity via color-mix or oklch alpha). */
  gridShimmerStroke?: string;
  /** Animate a shimmer band across grid lines. Default: true */
  gridShimmer?: boolean;
  /** Shimmer band width in pixels. Default: 140 */
  gridShimmerLength?: number;
  /** Shimmer speed multiplier (higher = faster). Default: 1 */
  gridShimmerSpeed?: number;
  /** Match shimmer loop to the loading line pulse (cycle + inter-loop pause). */
  gridShimmerSync?: boolean;
  /** Centered shimmer label text. Default: "Loading" */
  label?: string;
  /** Aspect ratio as "width / height". Default: "2 / 1". Use "auto" when the container sets height. */
  aspectRatio?: string;
  /** Additional class name for the container */
  className?: string;
}

export function CandlestickChartLoading({
  margin,
  candleFill = DEFAULT_CANDLE_FILL,
  gridStroke = DEFAULT_LOADING_GRID_STROKE,
  gridShimmerStroke = DEFAULT_LOADING_GRID_SHIMMER_STROKE,
  gridShimmer = true,
  gridShimmerLength,
  gridShimmerSpeed,
  gridShimmerSync = false,
  label = "Loading",
  aspectRatio = "2 / 1",
  className = "",
}: CandlestickChartLoadingProps) {
  const data = useMemo(() => generateCandleSkeletonData(), []);

  return (
    <div
      className={cn("relative w-full", className)}
      style={aspectRatio === "auto" ? undefined : { aspectRatio }}
    >
      <CandlestickChart
        animationDuration={0}
        aspectRatio="auto"
        className="h-full w-full"
        data={data}
        margin={margin}
      >
        <Grid
          horizontal
          shimmer={gridShimmer}
          shimmerLength={gridShimmerLength}
          shimmerSpeed={gridShimmerSpeed}
          shimmerStroke={gridShimmerStroke}
          shimmerSync={gridShimmerSync}
          stroke={gridStroke}
        />
        <Candlestick
          animate={false}
          negativeFill={candleFill}
          positiveFill={candleFill}
          showHoverFade={false}
        />
      </CandlestickChart>
      <ChartLoadingLabel text={label} />
    </div>
  );
}

export default CandlestickChartLoading;
