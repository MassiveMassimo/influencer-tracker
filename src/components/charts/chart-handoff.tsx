"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";

// Two-layer blur crossfade from the loading skeleton to the real chart. The
// skeleton fades + blurs OUT while the chart fades + blurs IN, both stacked in
// the same grid cell so they overlap — the eye reads one shape resolving into
// focus rather than a hard swap (Kowalski: blur bridges imperfect crossfades).
// Grid-stacking sizes the box to content (works for fixed-height price charts
// and content-height bar panels alike). AnimatePresence `initial={false}` so
// the first paint (chart already ready, no skeleton) doesn't fade in — only an
// actual loading→ready transition crossfades. Reduced motion → opacity only.
//
// Once the chart has entered, the layer settles to `filter: none` and drops
// `will-change` — a lingering `filter` ancestor (even `blur(0px)`) isolates
// descendant `backdrop-filter`, which kills the crosshair tooltip's frosted bg.
export function ChartHandoff({
  loading,
  skeleton,
  className,
  blur = 8,
  durationMs = 500,
  children,
}: {
  loading: boolean;
  skeleton: ReactNode;
  className?: string;
  /** Peak blur (px) each layer crosses through. Keep <20 (Safari). */
  blur?: number;
  /** Crossfade duration (ms). */
  durationMs?: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [settled, setSettled] = useState(false);
  // Re-arm the blur-in entrance whenever we drop back to loading (e.g. a
  // timeframe switch re-shows the skeleton), so the next reveal crossfades.
  useEffect(() => {
    if (loading) setSettled(false);
  }, [loading]);

  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, filter: `blur(${blur}px)` };
  const shown = { opacity: 1, filter: "blur(0px)" };
  const rest = { opacity: 1, filter: "none" };
  const transition = {
    duration: durationMs / 1000,
    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
  };
  return (
    <div className={`grid ${className ?? ""}`}>
      <AnimatePresence initial={false} mode="sync">
        {loading ? (
          <motion.div
            animate={shown}
            className="col-start-1 row-start-1 min-w-0"
            exit={hidden}
            initial={false}
            key="skeleton"
            style={{ willChange: "opacity, filter" }}
            transition={transition}
          >
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            animate={settled ? rest : shown}
            className="col-start-1 row-start-1 min-w-0"
            exit={hidden}
            initial={hidden}
            key="chart"
            onAnimationComplete={() => setSettled(true)}
            style={settled ? undefined : { willChange: "opacity, filter" }}
            transition={transition}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Resolves true once a lazy chunk's importer has loaded. Lets a Suspense-only
// chart (no data gate) drive ChartHandoff: hold the skeleton until the chunk is
// ready, then render the (now-synchronous) lazy component and dissolve the
// skeleton over its entrance. `load` must be a stable module-scope importer —
// the same one passed to React.lazy, so the dynamic import is shared/cached.
export function useChunkReady(load: () => Promise<unknown>): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    // Resolve on failure too: a failed chunk falls through to the real Suspense
    // boundary / error path rather than wedging on the skeleton forever.
    load().then(
      () => alive && setReady(true),
      () => alive && setReady(true),
    );
    return () => {
      alive = false;
    };
  }, [load]);
  return ready;
}
