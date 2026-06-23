"use client";

import { curveNatural } from "@visx/curve";
import { area as d3area, line as d3line } from "d3-shape";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef } from "react";
import { chartCssVars, useChartStable, useYScale } from "./chart-context";

// An area series that morphs its shape between data sets (e.g. timeframe
// switches) instead of hard-swapping. Same technique as the old MorphLine /
// motion.dev's SVG path-morph tutorial: motion's `animate(0, 1)` drives a mix
// fn that rewrites the `d` each frame, lerping vertex-to-vertex between the
// previous and target polylines (both resampled to a fixed point count, so a
// 1D ~78-bar → 1Y ~252-bar switch tweens cleanly). Renders both the closed area
// fill and the stroke from the same morphed points; `fillOpacity={0}` drops the
// fill, leaving a pure morphing reference line (used for SPY).

type Point = [number, number];

// Stateless module-level generators (not per-render). x=d[0], y=d[1].
const lineGen = d3line<Point>().curve(curveNatural);

const SAMPLES = 240;
// Matched to the candlestick crossfade (same 0.4s, same strong ease-out) so
// both charts read as one transition on a timeframe switch.
const MORPH_DURATION = 0.4;
const MORPH_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

// Resample a polyline to exactly `n` points by walking it at even index
// fractions — cheap, keeps curveNatural smooth at SAMPLES density.
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

export interface MorphAreaProps {
  /** Key in data to use for y values. */
  dataKey: string;
  /** Y-scale group id. Default: primary axis. */
  yAxisId?: string | number;
  /** Stroke + fill color. Default: var(--chart-line-primary) */
  stroke?: string;
  /** Stroke width. Default: 2.5 */
  strokeWidth?: number;
  /** Fill opacity at the top of the area (0 = line only). Default: 0.25 */
  fillOpacity?: number;
}

export function MorphArea({
  dataKey,
  yAxisId,
  stroke = chartCssVars.linePrimary,
  strokeWidth = 2.5,
  fillOpacity = 0.25,
}: MorphAreaProps) {
  const { renderData, xScale, innerHeight, xAccessor } = useChartStable();
  const yScale = useYScale(yAxisId);
  const reduce = useReducedMotion();

  const strokeRef = useRef<SVGPathElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  // The polyline currently painted (SAMPLES points), so an interrupted morph
  // resumes from the on-screen shape rather than snapping to the last target.
  const displayedRef = useRef<Point[] | null>(null);

  const showFill = fillOpacity > 0;

  // Target polyline in pixel space, resampled to a fixed count for vertex lerp.
  const points = useMemo(() => {
    const raw: Point[] = [];
    for (const d of renderData) {
      const value = d[dataKey];
      if (typeof value !== "number") {
        continue; // drop gaps (e.g. missing SPY bar) rather than dipping to 0
      }
      const x = xScale(xAccessor(d));
      const y = yScale(value);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        raw.push([x as number, y as number]);
      }
    }
    return resample(raw, SAMPLES);
  }, [renderData, xScale, yScale, xAccessor, dataKey]);

  // Closed-area generator with the baseline at the plot bottom (innerHeight).
  const areaGen = useMemo(
    () =>
      d3area<Point>()
        .x((p) => p[0])
        .y0(innerHeight)
        .y1((p) => p[1])
        .curve(curveNatural),
    [innerHeight]
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
    if (!from || reduce) {
      // First paint, or reduced motion: draw straight to target and seed the
      // displayed shape — no tween. (The shell's reveal still fades the group in
      // on mount.) Matches the rest of the app's reduced-motion handling.
      paint(points);
      displayedRef.current = points;
      return;
    }

    // Pre-allocated buffer mutated in place each frame to avoid GC churn.
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
  }, [points, areaGen, reduce]);

  const reactId = useId();
  const gradientId = `morph-area-fill-${dataKey}-${reactId}`;

  return (
    <>
      {showFill ? (
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={fillOpacity} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
      ) : null}

      {/* `d` is driven imperatively (mount + morph) so React never resets it to
          the target mid-tween, which would flash the end shape then morph back.
          Fill is painted under the stroke. */}
      {showFill ? (
        <path fill={`url(#${gradientId})`} ref={fillRef} stroke="none" />
      ) : null}
      <path
        fill="none"
        ref={strokeRef}
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </>
  );
}

MorphArea.displayName = "MorphArea";

export default MorphArea;
