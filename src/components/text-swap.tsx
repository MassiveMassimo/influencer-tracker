"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// Blur + slide text swap for headings that change in place (e.g. switching
// creators keeps the same <h1> node and only swaps its text). Ports the
// Transitions.dev "text states swap" recipe to motion's AnimatePresence: the old
// value exits up (blur + fade), the new value enters from below. `initial={false}`
// so the first render paints statically — only later value changes animate.
//
// `mode="popLayout"` pops the exiting value out of layout flow immediately, so a
// following sibling (e.g. a platform icon) reflows to the new text width in ONE
// step instead of collapsing to zero between exit and enter — that's what lets a
// `layout`-animated icon slide smoothly to its new x. The wrapper is `relative`
// so the popped (absolutely-positioned) exiting value stays put while it fades.
const TRANSITION = { duration: 0.15, ease: "easeInOut" } as const;

export function TextSwap({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span className={className}>{value}</span>;
  }
  return (
    <motion.span className="relative inline-block" layout="position">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ y: 0, filter: "blur(0px)", opacity: 1 }}
          className={`inline-block ${className ?? ""}`}
          exit={{ y: -4, filter: "blur(2px)", opacity: 0 }}
          initial={{ y: 4, filter: "blur(2px)", opacity: 0 }}
          key={value}
          style={{ willChange: "transform, filter, opacity" }}
          transition={TRANSITION}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

export default TextSwap;
