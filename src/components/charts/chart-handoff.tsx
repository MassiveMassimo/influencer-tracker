"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";

// Blur-dissolve handoff from the loading skeleton to the chart. The chart is the
// PERSISTENT layer and renders plain — no filter/transform/opacity wrapper — so
// its descendant `backdrop-filter` (the crosshair tooltip's frosted bg) keeps
// working. Any isolating ancestor, including a no-op `filter: blur(0px)`, makes
// backdrop-filter sample an empty backdrop: you get the bg tint with no actual
// blur of the graphics behind it. The skeleton is the ONLY animated layer — it
// stacks on top in the same grid cell and fades + blurs OUT, masking the chart's
// own entrance sweep beneath it (Kowalski: blur bridges imperfect transitions).
// `initial={false}` so a chart that's already ready on first paint shows no
// skeleton flash. Reduced motion → fade only. Grid-stacking sizes to content.
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
  /** Peak blur (px) the skeleton crosses through on exit. Keep <20 (Safari). */
  blur?: number;
  /** Dissolve duration (ms). */
  durationMs?: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const exitTo = reduce
    ? { opacity: 0 }
    : { opacity: 0, filter: `blur(${blur}px)` };
  const transition = {
    duration: durationMs / 1000,
    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
  };
  // isolate: contain the chart's z-50 tooltip portal in its own stacking context
  // so it can't paint over the sticky page header (z-20) below it.
  return (
    <div className={`grid isolate ${className ?? ""}`}>
      <div className="col-start-1 row-start-1 min-w-0">{children}</div>
      <AnimatePresence initial={false}>
        {loading && (
          <motion.div
            className="col-start-1 row-start-1 z-10 min-w-0"
            exit={exitTo}
            initial={false}
            key="skeleton"
            style={{ willChange: "opacity, filter" }}
            transition={transition}
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
