"use client";

import { CircleQuestionMark } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  PreviewCard,
  PreviewCardTrigger,
  PreviewCardPopup,
} from "#/components/ui/preview-card.tsx";
import { badgeKindFor, type HalalInfo } from "#/lib/halal/types.ts";
import { EASE_OUT } from "#/lib/ease.ts";
import { HalalCardContent } from "./halal-card-content.tsx";

export function HalalBadge({ info }: { info: HalalInfo }) {
  const kind = badgeKindFor(info.status);
  if (kind === "halal") {
    return (
      <span
        role="img"
        aria-label="Shariah-compliant (Musaffa)"
        className="icon-[hugeicons--halal] size-[1.1em] text-emerald-500 align-[-0.15em]"
      />
    );
  }
  if (kind === "doubtful") {
    return (
      <CircleQuestionMark
        aria-label="Shariah compliance questionable (Musaffa)"
        className="size-[1.1em] text-amber-500 align-[-0.15em]"
      />
    );
  }
  return null;
}

// Blur + scale presence animation for the badge, matching IconSwap: when the
// badge appears/disappears between items (e.g. navigating to a stock Musaffa
// doesn't rate) it fades in/out instead of popping, and `layout="position"` lets
// it — and any following sibling that also opts into layout — slide rather than
// jump when a preceding element (the ticker/symbol) changes width.
// `mode="popLayout"` takes the exiting badge out of flow so neighbours reflow in
// one step; `initial={false}` keeps it inert on first mount (list rows never
// toggle in place, so they don't animate).
// Presence (blur+scale) at 0.25s; the `layout` slide is snappier so it keeps up
// with the 150ms text swap that drives the badge's reposition.
const BADGE_TRANSITION = {
  duration: 0.25,
  ease: EASE_OUT,
  layout: { duration: 0.18, ease: EASE_OUT },
} as const;

export function HalalIndicator({ info }: { info: HalalInfo }) {
  const reduce = useReducedMotion();
  const show = badgeKindFor(info.status) !== null;

  const indicator = (
    <PreviewCard>
      {/* Badge + popup often sit inside a row-level <Link>; clicks bubble through the
          React tree (even from the portaled popup) to the row. Contain them at the two
          subtree roots — trigger and popup — so HalalCardContent stays Link-agnostic. */}
      <PreviewCardTrigger
        render={
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex cursor-default items-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Halal compliance details"
          />
        }
      >
        <HalalBadge info={info} />
      </PreviewCardTrigger>
      <PreviewCardPopup
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl border border-border/60 bg-background p-3 shadow-lg"
      >
        <HalalCardContent info={info} />
      </PreviewCardPopup>
    </PreviewCard>
  );

  if (reduce) {
    return show ? indicator : null;
  }

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {show && (
        <motion.span
          animate={{ scale: 1, filter: "blur(0px)", opacity: 1 }}
          className="inline-flex"
          exit={{ scale: 0.25, filter: "blur(2px)", opacity: 0 }}
          initial={{ scale: 0.25, filter: "blur(2px)", opacity: 0 }}
          key="badge"
          layout="position"
          transition={BADGE_TRANSITION}
        >
          {indicator}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
