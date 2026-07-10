"use client";

import type { Transition } from "motion/react";
import { motion, useReducedMotion } from "motion/react";
import { memo, useMemo } from "react";
import { useChart } from "./chart-context";
import { useChartLegendHover } from "./chart-legend-hover";
import { transitionWithDelay } from "./motion-utils";
import { useTouchPrimaryEager } from "#/hooks/use-has-primary-touch.tsx";
import { EASE_OUT } from "#/lib/ease.ts";

// Steady-state candles morph their geometry (lengthen/shorten, move up/down)
// when `data` changes without a remount — i.e. switching ticker/creator pages,
// which keeps the chart mounted and only swaps the OHLC. Each candle slot is
// keyed by its ordinal position in the window (not the bar's date), so the Nth
// candle morphs to the Nth candle across the swap even when the two symbols'
// calendars differ — e.g. a crypto symbol (trades weekends) ↔ an equity. Matched
// to the area morph (0.4s, strong ease-out) so both charts read as one
// transition. Reduced-motion users get SNAP_TRANSITION (instant), matching the
// rest of the app's motion components (icon-swap, halal-badge, …).
//
// Known limitation, shared with the area chart: the candle yScale snaps on the
// data swap while bodies tween, so the y-axis/grid jump a frame ahead of the
// candles. Animating the shared domain (per use-animated-y-domains) would force a
// per-frame re-render of every candle + axis, costing more than it buys; left as
// a deliberate tradeoff.
const MORPH_TRANSITION: Transition = { duration: 0.4, ease: EASE_OUT };
const SNAP_TRANSITION: Transition = { duration: 0 };

const DEFAULT_POSITIVE = "url(#candlestick-positive)";
const DEFAULT_NEGATIVE = "url(#candlestick-negative)";

const SOLID_POSITIVE = "var(--chart-1)";
const SOLID_NEGATIVE = "var(--chart-5)";
const WICK_WIDTH = 1.5;

export interface CandlestickProps {
  /** Whether to animate the candlesticks. Default: true */
  animate?: boolean;
  /** Fill for positive (close >= open) candles. Color or url(#gradient). Default: --chart-1 */
  positiveFill?: string;
  /** Fill for negative candles. Color or url(#gradient). Default: --chart-5 */
  negativeFill?: string;
  /** Optional pattern URL for body only (e.g. url(#pattern)). When set, body is drawn solid first, then pattern overlaid and masked to the body rect. */
  bodyPatternPositive?: string;
  /** Optional pattern URL for negative candle body. */
  bodyPatternNegative?: string;
  /** Inner border width on the body (drawn inside so it does not expand the shape). Default: 0 (off). */
  insideStrokeWidth?: number;
  /** Opacity when another candle is hovered. Default: 0.3 */
  fadedOpacity?: number;
  /** Dim non-hovered candles on hover. Default: true */
  showHoverFade?: boolean;
}

interface CandleGeometry {
  time: number;
  centerX: number;
  bodyTop: number;
  bodyHeight: number;
  bodyLeft: number;
  candleWidth: number;
  wickTop: number;
  wickHeight: number;
  wickLeft: number;
  bodySolidFill: string;
  wickFill: string;
  bodyPattern?: string;
  insideStrokeWidth: number;
  isPositive: boolean;
}

function getSolidColor(isPositive: boolean): string {
  return isPositive ? SOLID_POSITIVE : SOLID_NEGATIVE;
}

function computeGeometries(
  renderData: Record<string, unknown>[],
  xScale: (value: Date) => number | undefined,
  yScale: (value: number) => number | undefined,
  xAccessor: (d: Record<string, unknown>) => Date,
  candleWidth: number,
  positiveFill: string,
  negativeFill: string,
  bodyPatternPositive: string | undefined,
  bodyPatternNegative: string | undefined,
  insideStrokeWidth: number,
): CandleGeometry[] {
  return renderData.map((d) => {
    const date = xAccessor(d);
    const open = d.open as number;
    const high = d.high as number;
    const low = d.low as number;
    const close = d.close as number;
    const centerX = xScale(date) ?? 0;
    const yHigh = yScale(high) ?? 0;
    const yLow = yScale(low) ?? 0;
    const yOpen = yScale(open) ?? 0;
    const yClose = yScale(close) ?? 0;
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.abs(yClose - yOpen) || 1;
    const bodyLeft = centerX - candleWidth / 2;
    const wickTop = Math.min(yHigh, yLow);
    const wickHeight = Math.abs(yLow - yHigh) || 1;
    const isPositive = close >= open;
    const fill = isPositive ? positiveFill : negativeFill;
    const bodyPattern = isPositive ? bodyPatternPositive : bodyPatternNegative;
    const hasPatternOverlay = Boolean(bodyPattern);
    const bodySolidFill = hasPatternOverlay ? getSolidColor(isPositive) : fill;

    return {
      time: date.getTime(),
      centerX,
      bodyTop,
      bodyHeight,
      bodyLeft,
      candleWidth,
      wickTop,
      wickHeight,
      wickLeft: centerX - WICK_WIDTH / 2,
      bodySolidFill,
      wickFill: hasPatternOverlay ? bodySolidFill : fill,
      bodyPattern: hasPatternOverlay ? bodyPattern : undefined,
      insideStrokeWidth,
      isPositive,
    };
  });
}

function geometryDimOpacity(
  geometry: CandleGeometry,
  fadedOpacity: number,
  legendHoveredIndex: number | null,
  hoveredTime: number | null,
): number {
  if (legendHoveredIndex !== null) {
    const dimFromLegend =
      (legendHoveredIndex === 0 && !geometry.isPositive) ||
      (legendHoveredIndex === 1 && geometry.isPositive);
    return dimFromLegend ? fadedOpacity : 1;
  }
  if (hoveredTime !== null && geometry.time !== hoveredTime) {
    return fadedOpacity;
  }
  return 1;
}

// Static (snap-positioned) candle. Used only by the hover-highlight overlay,
// which wants the highlighted candle to track the crosshair instantly, not tween.
// Shares its exact shape set (wick + body + optional pattern + inside stroke) with
// the morphing MorphCandleBody below — keep the two in sync if either changes.
const CandlestickBody = memo(function CandlestickBody({ geometry }: { geometry: CandleGeometry }) {
  const {
    wickLeft,
    wickTop,
    wickHeight,
    wickFill,
    bodyLeft,
    bodyTop,
    bodyHeight,
    candleWidth,
    bodySolidFill,
    bodyPattern,
    insideStrokeWidth,
  } = geometry;

  return (
    <>
      <rect fill={wickFill} height={wickHeight} width={WICK_WIDTH} x={wickLeft} y={wickTop} />
      <rect
        fill={bodySolidFill}
        height={bodyHeight}
        rx={1}
        ry={1}
        stroke={bodySolidFill}
        strokeWidth={1}
        width={candleWidth}
        x={bodyLeft}
        y={bodyTop}
      />
      {bodyPattern ? (
        <rect
          fill={bodyPattern}
          height={bodyHeight}
          rx={1}
          ry={1}
          width={candleWidth}
          x={bodyLeft}
          y={bodyTop}
        />
      ) : null}
      {insideStrokeWidth > 0 ? (
        <rect
          fill="none"
          height={bodyHeight - insideStrokeWidth}
          rx={1}
          ry={1}
          stroke={bodySolidFill}
          strokeWidth={insideStrokeWidth}
          width={candleWidth - insideStrokeWidth}
          x={bodyLeft + insideStrokeWidth / 2}
          y={bodyTop + insideStrokeWidth / 2}
        />
      ) : null}
    </>
  );
});

// Morphing twin of CandlestickBody: same shapes, but x/y/width/height animate so
// the candle slides + stretches to its new size on a data swap. Fill is a plain
// prop (gradient url()s can't tween), so a sign flip recolors instantly while the
// shape morphs — the TradingView convention.
//
// `initial={false}` is load-bearing: SVG geometry attrs (x/y/width/height) are
// NOT seeded from the animate target on mount the way transforms are — without
// it motion animates each rect from 0/0/0/0, so a freshly-mounted candle would
// grow from a zero-size box in the top-left. This component only mounts after the
// enter sweep (the `!isLoaded` AnimatedCandle branch handles first paint), so
// suppressing its mount animation is exactly right; it tweens only on later
// data-swap updates.
const MorphCandleBody = memo(function MorphCandleBody({
  geometry,
  transition,
}: {
  geometry: CandleGeometry;
  transition: Transition;
}) {
  const {
    wickLeft,
    wickTop,
    wickHeight,
    wickFill,
    bodyLeft,
    bodyTop,
    bodyHeight,
    candleWidth,
    bodySolidFill,
    bodyPattern,
    insideStrokeWidth,
  } = geometry;

  return (
    <>
      <motion.rect
        animate={{ x: wickLeft, y: wickTop, height: wickHeight }}
        fill={wickFill}
        initial={false}
        transition={transition}
        width={WICK_WIDTH}
      />
      <motion.rect
        animate={{ x: bodyLeft, y: bodyTop, width: candleWidth, height: bodyHeight }}
        fill={bodySolidFill}
        initial={false}
        rx={1}
        ry={1}
        stroke={bodySolidFill}
        strokeWidth={1}
        transition={transition}
      />
      {bodyPattern ? (
        <motion.rect
          animate={{ x: bodyLeft, y: bodyTop, width: candleWidth, height: bodyHeight }}
          fill={bodyPattern}
          initial={false}
          rx={1}
          ry={1}
          transition={transition}
        />
      ) : null}
      {insideStrokeWidth > 0 ? (
        <motion.rect
          animate={{
            x: bodyLeft + insideStrokeWidth / 2,
            y: bodyTop + insideStrokeWidth / 2,
            width: candleWidth - insideStrokeWidth,
            height: bodyHeight - insideStrokeWidth,
          }}
          fill="none"
          initial={false}
          rx={1}
          ry={1}
          stroke={bodySolidFill}
          strokeWidth={insideStrokeWidth}
          transition={transition}
        />
      ) : null}
    </>
  );
});

const CandlestickBodies = memo(function CandlestickBodies({
  geometries,
  fadedOpacity,
  legendHoveredIndex,
  hoveredTime,
  morphTransition,
}: {
  geometries: CandleGeometry[];
  fadedOpacity: number;
  legendHoveredIndex: number | null;
  hoveredTime: number | null;
  morphTransition: Transition;
}) {
  return (
    <>
      {geometries.map((geometry, index) => (
        // Keyed by ordinal position, not bar time: candles are always in
        // chronological order and only the tail count changes between symbols, so
        // index keys are stable AND let the Nth candle persist (and morph) across
        // a swap even when calendars differ. Dimming still keys on geometry.time
        // inside geometryDimOpacity, so hover behaviour is unaffected.
        <g
          key={index}
          opacity={geometryDimOpacity(geometry, fadedOpacity, legendHoveredIndex, hoveredTime)}
          style={{ transition: "opacity 0.15s ease-in-out" }}
        >
          <MorphCandleBody geometry={geometry} transition={morphTransition} />
        </g>
      ))}
    </>
  );
});

interface AnimatedCandleProps {
  geometry: CandleGeometry;
  delay: number;
  enterTransition: Transition;
  revealEpoch: number;
}

function AnimatedCandle({ geometry, delay, enterTransition, revealEpoch }: AnimatedCandleProps) {
  const t = transitionWithDelay(enterTransition, delay);
  const bodyOrigin = `${geometry.centerX}px ${geometry.bodyTop + geometry.bodyHeight / 2}px`;
  const wickCenterY = geometry.wickTop + geometry.wickHeight / 2;

  return (
    <motion.g
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      key={`candle-enter-${geometry.time}-${revealEpoch}`}
      style={{ transformOrigin: `${geometry.centerX}px ${wickCenterY}px` }}
      transition={{ ...t, opacity: { duration: 0.15 } }}
    >
      <motion.rect
        animate={{ scaleY: 1 }}
        fill={geometry.wickFill}
        height={geometry.wickHeight}
        initial={{ scaleY: 0 }}
        style={{ transformOrigin: `${geometry.centerX}px ${wickCenterY}px` }}
        transition={t}
        width={WICK_WIDTH}
        x={geometry.wickLeft}
        y={geometry.wickTop}
      />
      <motion.rect
        animate={{ scaleY: 1 }}
        fill={geometry.bodySolidFill}
        height={geometry.bodyHeight}
        initial={{ scaleY: 0 }}
        rx={1}
        ry={1}
        stroke={geometry.bodySolidFill}
        strokeWidth={1}
        style={{ transformOrigin: bodyOrigin }}
        transition={t}
        width={geometry.candleWidth}
        x={geometry.bodyLeft}
        y={geometry.bodyTop}
      />
      {geometry.bodyPattern ? (
        <motion.rect
          animate={{ scaleY: 1 }}
          fill={geometry.bodyPattern}
          height={geometry.bodyHeight}
          initial={{ scaleY: 0 }}
          rx={1}
          ry={1}
          style={{ transformOrigin: bodyOrigin }}
          transition={t}
          width={geometry.candleWidth}
          x={geometry.bodyLeft}
          y={geometry.bodyTop}
        />
      ) : null}
    </motion.g>
  );
}

export function Candlestick({
  animate = true,
  positiveFill = DEFAULT_POSITIVE,
  negativeFill = DEFAULT_NEGATIVE,
  bodyPatternPositive,
  bodyPatternNegative,
  insideStrokeWidth = 0,
  fadedOpacity = 0.3,
  showHoverFade = true,
}: CandlestickProps) {
  const {
    data,
    xScale,
    yScale,
    xAccessor,
    animationDuration,
    enterTransition,
    revealEpoch = 0,
    isLoaded,
    bandWidth,
    columnWidth,
    hoveredCandleIndex,
  } = useChart();
  const { hoveredIndex: legendHoveredIndex } = useChartLegendHover();
  // Reads the OS prefers-reduced-motion (matching icon-swap/halal-badge/
  // category-bars). NOTE: the app's manual data-reduce-motion toggle only zeroes
  // CSS transitions, not motion's JS-driven animate — a repo-wide gap, not unique
  // to this chart. Touch devices also snap (no reveal sweep / candle morph on a
  // timeframe switch) — local patch, re-apply after a bklit resync.
  const prefersReduced = useReducedMotion();
  const isTouch = useTouchPrimaryEager();
  const reduce = prefersReduced === true || isTouch;

  const candleWidth = Math.min(bandWidth ?? columnWidth * 0.8, columnWidth);

  const geometries = useMemo(
    () =>
      computeGeometries(
        data,
        xScale,
        yScale,
        xAccessor,
        candleWidth,
        positiveFill,
        negativeFill,
        bodyPatternPositive,
        bodyPatternNegative,
        insideStrokeWidth,
      ),
    [
      data,
      xScale,
      yScale,
      xAccessor,
      candleWidth,
      positiveFill,
      negativeFill,
      bodyPatternPositive,
      bodyPatternNegative,
      insideStrokeWidth,
    ],
  );

  const hoveredTime = useMemo(() => {
    if (hoveredCandleIndex == null) {
      return null;
    }
    const point = data[hoveredCandleIndex];
    return point ? xAccessor(point).getTime() : null;
  }, [hoveredCandleIndex, data, xAccessor]);

  const highlightGeometry = useMemo(() => {
    if (hoveredCandleIndex == null) {
      return null;
    }
    const point = data[hoveredCandleIndex];
    if (!point) {
      return null;
    }
    return (
      computeGeometries(
        [point],
        xScale,
        yScale,
        xAccessor,
        candleWidth,
        positiveFill,
        negativeFill,
        bodyPatternPositive,
        bodyPatternNegative,
        insideStrokeWidth,
      )[0] ?? null
    );
  }, [
    hoveredCandleIndex,
    data,
    xScale,
    yScale,
    xAccessor,
    candleWidth,
    positiveFill,
    negativeFill,
    bodyPatternPositive,
    bodyPatternNegative,
    insideStrokeWidth,
  ]);

  const defaultEnter: Transition = {
    type: "spring",
    duration: 0.8,
    bounce: 0.15,
  };
  const enter = enterTransition ?? defaultEnter;
  const staggerDelayMs = data.length > 0 ? (animationDuration * 0.6) / data.length : 0;

  // Reduced motion skips the enter sweep entirely (render the steady bodies
  // straight away); the steady morph is snapped to 0s below.
  if (animate && !isLoaded && !reduce) {
    return (
      <g className="chart-candlesticks">
        {geometries.map((geometry, index) => (
          <AnimatedCandle
            delay={(index * staggerDelayMs) / 1000}
            enterTransition={enter}
            geometry={geometry}
            key={geometry.time}
            revealEpoch={revealEpoch}
          />
        ))}
      </g>
    );
  }

  return (
    <g className="chart-candlesticks">
      <CandlestickBodies
        fadedOpacity={fadedOpacity}
        geometries={geometries}
        hoveredTime={showHoverFade ? hoveredTime : null}
        legendHoveredIndex={legendHoveredIndex}
        morphTransition={reduce ? SNAP_TRANSITION : MORPH_TRANSITION}
      />
      {highlightGeometry ? (
        <g>
          <CandlestickBody geometry={highlightGeometry} />
        </g>
      ) : null}
    </g>
  );
}

Candlestick.displayName = "Candlestick";

export default Candlestick;
