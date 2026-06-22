"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

// Blur-dissolve handoff from the loading skeleton to the real chart. While
// loading the skeleton sits on top; when data arrives the chart renders
// underneath and draws itself in (its own clip reveal), and the skeleton fades
// + blurs out over it — the shimmer melts away to reveal the chart mid-draw.
// Blur masks the crossfade between two structurally different visuals (shimmer
// bars vs the real series) so the eye reads one shape resolving into focus
// rather than a hard swap (Kowalski: blur bridges imperfect crossfades).
//
// Reduced motion → opacity-only fade, no blur. The container must carry a
// definite height (both layers are absolute inset-0), e.g. className="h-[320px]".
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
    <div className={`relative ${className ?? ""}`}>
      {!loading && <div className="absolute inset-0">{children}</div>}
      <AnimatePresence>
        {loading && (
          <motion.div
            // initial={false}: the skeleton is already on screen during loading,
            // so it only animates on exit (the dissolve), never on enter.
            animate={{ opacity: 1, filter: "blur(0px)" }}
            className="absolute inset-0"
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
