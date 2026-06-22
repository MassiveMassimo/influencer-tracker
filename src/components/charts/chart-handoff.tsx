"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";

// Blur-dissolve handoff from the loading skeleton to the real chart. While
// loading the skeleton sits on top; when the chart is ready it renders
// underneath and draws itself in (its own clip reveal), and the skeleton fades
// + blurs out over it — the shimmer melts away to reveal the chart mid-draw.
// Blur masks the crossfade between two structurally different visuals (shimmer
// bars vs the real series) so the eye reads one shape resolving into focus
// rather than a hard swap (Kowalski: blur bridges imperfect crossfades).
//
// Both layers are grid-stacked in the same cell, so the box sizes to its
// content — no fixed height required (works for the fixed-height price charts
// and the content-height bar panels alike). Reduced motion → opacity-only fade.
export function ChartHandoff({
  loading,
  skeleton,
  className,
  blur = 8,
  children,
}: {
  loading: boolean;
  skeleton: ReactNode;
  className?: string;
  /** Peak blur (px) the skeleton reaches as it dissolves. Keep <20 (Safari). */
  blur?: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={`grid ${className ?? ""}`}>
      {!loading && <div className="col-start-1 row-start-1 min-w-0">{children}</div>}
      <AnimatePresence>
        {loading && (
          <motion.div
            // initial={false}: the skeleton is already on screen during loading,
            // so it only animates on exit (the dissolve), never on enter.
            className="col-start-1 row-start-1 min-w-0"
            exit={reduce ? { opacity: 0 } : { opacity: 0, filter: `blur(${blur}px)` }}
            initial={false}
            key="skeleton"
            style={{ willChange: "opacity, filter" }}
            // Strong ease-out (built-in easings lack punch); matches the
            // timeframe ChartCrossfade vibe, slightly longer so it overlaps the
            // chart's clip-reveal draw-in.
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
          >
            {skeleton}
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
