"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// An iconify icon that (a) slides smoothly to its new x when a preceding element
// changes width — via motion `layout="position"` — instead of hard-jumping, and
// (b) cross-fades with a blur + scale-up when the icon identity itself changes
// (e.g. switching from an X creator to an IG one). Ports the Transitions.dev
// "icon swap" recipe to AnimatePresence. `icon` is the full iconify class string
// (e.g. "icon-[mdi--instagram]"); `className` carries sizing/color/hover styles.
//
// The glyphs are grid-stacked (one cell) so the cross-fade never shifts layout,
// and `layout="position"` animates only position, never size (the icon is a fixed
// 1em square). `initial={false}` keeps the first paint static.
const TRANSITION = { duration: 0.25, ease: "easeInOut" } as const;

export function IconSwap({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span aria-hidden className={`${icon} ${className ?? ""}`} />;
  }
  return (
    <motion.span className="inline-grid" layout="position">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ scale: 1, filter: "blur(0px)", opacity: 1 }}
          aria-hidden
          className={`${icon} ${className ?? ""}`}
          exit={{ scale: 0.25, filter: "blur(2px)", opacity: 0 }}
          initial={{ scale: 0.25, filter: "blur(2px)", opacity: 0 }}
          key={icon}
          style={{ gridArea: "1 / 1" }}
          transition={TRANSITION}
        />
      </AnimatePresence>
    </motion.span>
  );
}

export default IconSwap;
