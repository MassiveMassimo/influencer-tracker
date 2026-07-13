"use client";

// lucide-animated (pqoqubbw/icons), adapted to our stack. Hover nudges the arrow
// left (the "collapse" hint). Exposes start/stopAnimation so an enclosing button
// drives it on button hover, matching the other copy-in animated icons.
import {
  motion,
  useAnimation,
  useReducedMotion,
  type Transition,
  type Variants,
} from "motion/react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "#/lib/utils.ts";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types.ts";

// Strong ease-in-out (out-and-back nudge); built-in easings are too weak.
const TRANSITION: Transition = { duration: 0.22, ease: [0.77, 0, 0.175, 1] };
const ARROW_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: { x: [0, -3, 0] },
};

const PanelLeftCloseIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const reduced = useReducedMotion();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => !reduced && controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseEnter?.(e);
        else if (!reduced) controls.start("animate");
      },
      [controls, reduced, onMouseEnter],
    );
    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseLeave?.(e);
        else controls.start("normal");
      },
      [controls, onMouseLeave],
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
          <motion.path
            animate={controls}
            d="m16 15-3-3 3-3"
            transition={TRANSITION}
            variants={ARROW_VARIANTS}
          />
        </svg>
      </div>
    );
  },
);
PanelLeftCloseIcon.displayName = "PanelLeftCloseIcon";

export { PanelLeftCloseIcon };
