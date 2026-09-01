"use client";

import { AnimatePresence, domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePreferences } from "#/lib/preferences.tsx";
import {
  formatAnimatedNumber,
  getAnimatedNumberTokensFromFormatted,
  getStatDigitMotionProps,
  HIDDEN_BELOW,
  STAT_LAYOUT_TRANSITION,
  STAT_REMOVED_CHARACTER_EXIT,
} from "./animated-stat-number-motion.ts";

const subscribeToNoopStore = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;
const STATIC_CHARACTER_MOTION = {
  initial: false,
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const;
const NUMBER_CONTAINER_CLASS = "relative inline-flex whitespace-nowrap";
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
  const hydrated = useSyncExternalStore(
    subscribeToNoopStore,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const shouldReduceMotion = osReduceMotion || reduceMotion;
  const formatted = formatAnimatedNumber(value, format);
  const previousFormatted = useSyncExternalStore(
    subscribeToNoopStore,
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

  if (!hydrated || shouldReduceMotion) {
    return <span className={NUMBER_CONTAINER_CLASS}>{formatted}</span>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <span className={NUMBER_CONTAINER_CLASS}>
        <span className="sr-only">{formatted}</span>
        <m.span aria-hidden className="inline-flex">
          <AnimatePresence mode="popLayout">
            {tokens.map(({ character, digitIndex, slotFromRight }) => {
              const isDigit = digitIndex !== null;
              const characterMotion = isDigit
                ? getStatDigitMotionProps(false, digitIndex)
                : STATIC_CHARACTER_MOTION;
              const shouldShowCharacter = !isDigit || revealed || isCarryingPreviousValue;
              return (
                <m.span
                  layout="position"
                  transition={{ layout: STAT_LAYOUT_TRANSITION }}
                  className="relative inline-grid overflow-hidden"
                  exit={STAT_REMOVED_CHARACTER_EXIT}
                  key={`slot-${slotFromRight}`}
                >
                  <AnimatePresence>
                    <m.span
                      {...characterMotion}
                      animate={shouldShowCharacter ? characterMotion.animate : HIDDEN_BELOW}
                      className="col-start-1 row-start-1 inline-block"
                      key={character}
                    >
                      {character}
                    </m.span>
                  </AnimatePresence>
                </m.span>
              );
            })}
          </AnimatePresence>
        </m.span>
      </span>
    </LazyMotion>
  );
}
