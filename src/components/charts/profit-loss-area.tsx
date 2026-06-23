"use client";

import { curveLinear } from "@visx/curve";
import { area as d3area, line as d3line } from "d3-shape";
import { animate } from "motion/react";
import { useEffect, useId, useMemo, useRef } from "react";
import { EASE_OUT } from "#/lib/ease.ts";
import { useChartStable, useYScale } from "./chart-context";

// Sign-split filled area: fills between the series and a baseline (default 0),
// green above the baseline and red below. Forked from the synced bklit `Area`
// rather than patching it, because bklit's `Area`/`MorphArea` close the fill at
// the chart floor (visx `AreaClosed` defaults y0 to the bottom of the y-range,
// `MorphArea` hardcodes `.y0(innerHeight)`) and expose no baseline prop. A
// cumulative-excess-vs-SPY curve crosses zero, so the fill must close at
// `yScale(0)`. Lives in its own file so a `@bklit` chart re-sync never clobbers
// it.
//
// The two-tone split is a single vertical gradient with a hard stop at the
// baseline pixel (userSpaceOnUse, tied to `zeroY` not the path bbox): pixels
// above the baseline only ever sit in the green band, pixels below in the red
// band — so one path paints both regions correctly.
//
// The path also MORPHS between data sets (the same vertex-lerp MorphArea uses on
// the ticker page) so the curve tweens when switching creators instead of hard-
// swapping: both the closed fill and the stroke are repainted imperatively each
// frame from a polyline resampled to a fixed point count. The color bands are
// fixed in screen space (userSpaceOnUse), so during a morph the colors stay
// anchored to the (new) zero line while the path tweens through them.

type Point = [number, number];

const lineGen = d3line<Point>().curve(curveLinear);

const SAMPLES = 240;
// Matched to MorphArea / the candlestick crossfade so all chart transitions read
// as one motion.
const MORPH_DURATION = 0.4;
const MORPH_EASE = EASE_OUT;

// Resample a polyline to exactly `n` points by walking it at even index
// fractions, so a switch between series of different lengths tweens cleanly.
function resample(points: Point[], n: number): Point[] {
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return Array.from({ length: n }, () => points[0]);
  }
  const out: Point[] = [];
  const last = points.length - 1;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * last;
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, last);
    const f = t - lo;
    const a = points[lo];
    const b = points[hi];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

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

  const strokeRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  // Polyline currently painted, so an interrupted morph resumes on-screen
  // rather than snapping to the last target.
  const displayedRef = useRef<Point[] | null>(null);

  // Target polyline in pixel space, resampled to a fixed count for vertex lerp.
  const points = useMemo(() => {
    const raw: Point[] = [];
    for (const d of renderData) {
      const value = d[dataKey];
      if (typeof value !== "number") {
        continue;
      }
      const x = xScale(xAccessor(d));
      const y = yScale(value);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        raw.push([x as number, y as number]);
      }
    }
    return resample(raw, SAMPLES);
  }, [renderData, xScale, yScale, xAccessor, dataKey]);

  // Closed-area generator with the baseline at the (clamped) zero pixel.
  const areaGen = useMemo(
    () =>
      d3area<Point>()
        .x((p) => p[0])
        .y0(zeroY)
        .y1((p) => p[1])
        .curve(curveLinear),
    [zeroY]
  );

  useEffect(() => {
    const strokePath = strokeRef.current;
    if (!strokePath || points.length === 0) {
      return;
    }
    const fillPath = fillRef.current;

    const paint = (pts: Point[]) => {
      strokePath.setAttribute("d", lineGen(pts) ?? "");
      if (fillPath) {
        fillPath.setAttribute("d", areaGen(pts) ?? "");
      }
    };

    const from = displayedRef.current;
    if (!from) {
      // First paint: draw straight to target (the shell's reveal wipes it in).
      paint(points);
      displayedRef.current = points;
      return;
    }

    // Pre-allocated buffer mutated each frame to avoid GC churn.
    const mixed: Point[] = from.map((p) => [p[0], p[1]]);
    const controls = animate(0, 1, {
      duration: MORPH_DURATION,
      ease: MORPH_EASE,
      onUpdate: (t) => {
        for (let i = 0; i < from.length; i++) {
          mixed[i][0] = from[i][0] + (points[i][0] - from[i][0]) * t;
          mixed[i][1] = from[i][1] + (points[i][1] - from[i][1]) * t;
        }
        displayedRef.current = mixed;
        paint(mixed);
      },
    });
    return () => controls.stop();
  }, [points, areaGen]);

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

      {/* `d` is driven imperatively (mount + morph) so React never resets it to
          the target mid-tween. Fill is painted under the stroke. */}
      <path fill={`url(#${fillId})`} ref={fillRef} stroke="none" />
      <path
        fill="none"
        ref={strokeRef}
        stroke={`url(#${strokeId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </>
  );
}

ProfitLossArea.displayName = "ProfitLossArea";

export default ProfitLossArea;
