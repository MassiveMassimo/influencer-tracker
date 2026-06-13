"use client";

import { curveNatural } from "@visx/curve";
import { line as d3line } from "d3-shape";
import { animate } from "motion/react";
import { useEffect, useId, useMemo, useRef } from "react";
import { chartCssVars, useChartStable } from "./chart-context";
import { type FadeEdges, fadeGradientStops, resolveFadeSides } from "./fade-edges";

// A line series that morphs its stroke between data sets (e.g. timeframe
// switches) instead of hard-swapping. Same technique as motion.dev's SVG path
// morph tutorial — motion's `animate(0, 1)` drives a mix function that rewrites
// the `d` each frame — but the mixer is built for an OPEN polyline rather than
// flubber's closed-shape interpolator (flubber returns rings, which would draw a
// closing baseline across an open line chart).
//
// Both the previous and target lines are resampled to a fixed point count, so a
// 1D (~78 bars) → 1Y (~252 bars) switch tweens vertex-to-vertex with no flubber
// needed. The morph is a pixel-space reshape: the y-scale and x-domain differ
// per timeframe, so it reads as the curve deforming, not a data-aligned slide.

type Point = [number, number];

// Stateless and dependency-free — one module-level generator, not a per-render
// useMemo. Operates on [x, y] tuples (d3.line defaults: x=d[0], y=d[1]).
const gen = d3line<Point>().curve(curveNatural);

const SAMPLES = 240;
// 0.4s matches the candlestick crossfade so both charts transition as one on a
// timeframe switch. Strong custom ease-in-out (the chart clip-reveal family):
// a morph is on-screen movement, which wants natural accel/decel, not ease-out.
const MORPH_DURATION = 0.4;
const MORPH_EASE: [number, number, number, number] = [0.85, 0, 0.15, 1];

// Resample a polyline to exactly `n` points by walking it at even index
// fractions — cheap, and enough to keep curveNatural smooth at SAMPLES density.
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

export interface MorphLineProps {
  /** Key in data to use for y values. */
  dataKey: string;
  /** Stroke color. Default: var(--chart-line-primary) */
  stroke?: string;
  /** Stroke width. Default: 2.5 */
  strokeWidth?: number;
  /** Fade the stroke toward transparent at the chart edges. Default: true */
  fadeEdges?: FadeEdges;
}

export function MorphLine({
  dataKey,
  stroke = chartCssVars.linePrimary,
  strokeWidth = 2.5,
  fadeEdges = true,
}: MorphLineProps) {
  const { renderData, xScale, yScale, xAccessor } = useChartStable();

  const pathRef = useRef<SVGPathElement>(null);
  // The polyline currently painted (SAMPLES points), so an interrupted morph
  // resumes from the on-screen shape rather than snapping to the last target.
  const displayedRef = useRef<Point[] | null>(null);

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

  useEffect(() => {
    const path = pathRef.current;
    if (!path || points.length === 0) {
      return;
    }

    const from = displayedRef.current;
    if (!from) {
      // First paint: draw straight to target, seed the displayed shape. The
      // chart shell's reveal still wipes/fades the whole group in on mount.
      path.setAttribute("d", gen(points) ?? "");
      displayedRef.current = points;
      return;
    }

    // Pre-allocated buffer mutated in place each frame — ~36 frames × 240 pts ×
    // 2 series would otherwise churn the GC mid-animation.
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
        path.setAttribute("d", gen(mixed) ?? "");
      },
    });
    return () => controls.stop();
  }, [points]);

  const reactId = useId();
  const gradientId = `morph-line-gradient-${dataKey}-${reactId}`;
  const fadeSides = resolveFadeSides(fadeEdges);
  const lineStroke = fadeSides.any ? `url(#${gradientId})` : stroke;
  const fadeStops = fadeSides.any ? fadeGradientStops(fadeSides) : null;

  return (
    <>
      {fadeStops ? (
        <defs>
          <linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
            {fadeStops.map((stop) => (
              <stop
                key={stop.offset}
                offset={stop.offset}
                style={{ stopColor: stroke, stopOpacity: stop.opacity }}
              />
            ))}
          </linearGradient>
        </defs>
      ) : null}

      {/* `d` is driven imperatively (mount + morph) so React never resets it to
          the target mid-tween, which would flash the end shape then morph back. */}
      <path
        fill="none"
        ref={pathRef}
        stroke={lineStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </>
  );
}

MorphLine.displayName = "MorphLine";

export default MorphLine;
