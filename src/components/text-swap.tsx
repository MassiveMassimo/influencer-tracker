"use client";

import { useEffect, useRef, useState } from "react";

// Faithful port of the Transitions.dev "text states swap" recipe: ONE element
// runs a three-phase swap on value change — exit up (blur + fade), swap the text
// and jump below with no transition, then release to animate back to rest. Pure
// CSS transitions (`.t-text-swap` in styles.css) so it stays GPU-composited and
// crisp; 150ms ease-in-out, 4px travel, 2px blur — identical to the reference.
//
// Single element means the width changes exactly once, at the swap midpoint while
// the text is invisible. The hook is exposed separately from the component so a
// heading can run the swap itself and, in the SAME render, re-render a following
// sibling that opts into motion `layout` (the platform icon, the halal badge) —
// that re-render is what lets motion re-measure and slide the sibling to its new
// x instead of jumping. (A self-contained <TextSwap> only re-renders itself, so a
// motion sibling would never get re-measured.)
//
// Reduced motion (OS or the manual Preferences toggle) skips the dance and swaps
// instantly.
const DUR_MS = 150;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.getAttribute("data-reduce-motion") === "true"
  );
}

// Drives the three-phase swap. Returns the ref to attach to the swapping span and
// the text it should currently render. State updates here re-render the caller, so
// call it in the component that also renders any `layout`-animated sibling.
export function useTextSwap(value: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (display === value) {
      return;
    }
    const el = ref.current;
    if (!el || prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    // Phase 1: exit the current text (up + blur + fade).
    el.classList.add("is-exit");
    const timer = window.setTimeout(() => {
      // Phase 2: swap text and jump below with no transition.
      setDisplay(value);
      el.classList.remove("is-exit");
      el.classList.add("is-enter-start");
      void el.offsetWidth; // force reflow so phase 3 animates from below
      // Phase 3: release — animates back to rest via the default transition.
      el.classList.remove("is-enter-start");
    }, DUR_MS);
    return () => window.clearTimeout(timer);
  }, [value, display]);

  return { ref, display };
}

export function TextSwap({ value, className }: { value: string; className?: string }) {
  const { ref, display } = useTextSwap(value);
  return (
    <span className={`t-text-swap ${className ?? ""}`} ref={ref}>
      {display}
    </span>
  );
}

export default TextSwap;
