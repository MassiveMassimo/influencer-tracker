"use client";

import { AnimatePresence, domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePreferences } from "#/lib/preferences.tsx";
import {
  getAnimatedNumberTokens,
  getAnimatedNumberTokensFromFormatted,
  getStatDigitMotionProps,
  HIDDEN_BELOW,
  STAT_LAYOUT_TRANSITION,
} from "./animated-stat-number-motion.ts";

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;
const STATIC_CHARACTER_MOTION = {
  initial: false,
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const;
const lastFormattedByLayoutKey = new Map<string, string>();

export function AnimatedStatNumber({
  value,
  format,
  revealed,
  layoutKey,
}: {
  value: number;
  format: Intl.NumberFormatOptions;
  revealed: boolean;
  layoutKey: string;
}) {
  const osReduceMotion = useReducedMotion() === true;
  const { reduceMotion } = usePreferences();
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const reduce = osReduceMotion || reduceMotion;
  const formatted = getAnimatedNumberTokens(value, format)
    .map(({ character }) => character)
    .join("");
  const previousFormatted = useSyncExternalStore(
    subscribeToHydration,
    () => lastFormattedByLayoutKey.get(layoutKey) ?? formatted,
    () => formatted,
  );
  const [advancedTo, setAdvancedTo] = useState<string | null>(null);
  const isCarryingPreviousValue = previousFormatted !== formatted && advancedTo !== formatted;
  const visualFormatted = isCarryingPreviousValue ? previousFormatted : formatted;
  const tokens = getAnimatedNumberTokensFromFormatted(visualFormatted);

  useEffect(() => {
    lastFormattedByLayoutKey.set(layoutKey, formatted);
    if (!isCarryingPreviousValue) return;

    const frame = requestAnimationFrame(() => setAdvancedTo(formatted));
    return () => cancelAnimationFrame(frame);
  }, [formatted, isCarryingPreviousValue, layoutKey]);

  if (!mounted || reduce) {
    return <span>{formatted}</span>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.span
        layout="size"
        transition={{ layout: STAT_LAYOUT_TRANSITION }}
        className="inline-flex whitespace-nowrap"
      >
        <span className="sr-only">{formatted}</span>
        <m.span
          aria-hidden
          layout
          transition={{ layout: STAT_LAYOUT_TRANSITION }}
          className="inline-flex"
        >
          <AnimatePresence mode="popLayout">
            {tokens.map((token) => {
              const motionProps =
                token.digitIndex === null
                  ? STATIC_CHARACTER_MOTION
                  : getStatDigitMotionProps(false, token.digitIndex);
              return (
                <m.span
                  layout="position"
                  transition={{ layout: STAT_LAYOUT_TRANSITION }}
                  className="relative inline-grid overflow-hidden"
                  exit={motionProps.exit}
                  key={`slot-${token.slotFromRight}`}
                >
                  <AnimatePresence>
                    <m.span
                      {...motionProps}
                      animate={
                        token.digitIndex === null || revealed || isCarryingPreviousValue
                          ? motionProps.animate
                          : HIDDEN_BELOW
                      }
                      className="col-start-1 row-start-1 inline-block"
                      key={token.character}
                    >
                      {token.character}
                    </m.span>
                  </AnimatePresence>
                </m.span>
              );
            })}
          </AnimatePresence>
        </m.span>
      </m.span>
    </LazyMotion>
  );
}
