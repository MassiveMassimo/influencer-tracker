"use client";

import { AnimatePresence, domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePreferences } from "#/lib/preferences.tsx";
import {
  formatAnimatedNumber,
  getAnimatedNumberTokensFromFormatted,
  getAnimatedNumberGlyphMotionProps,
  HIDDEN_BELOW,
  NUMBER_LAYOUT_TRANSITION,
  NUMBER_REMOVED_CHARACTER_EXIT,
} from "./animated-number-motion.ts";

const subscribeToNoopStore = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;
const STATIC_CHARACTER_MOTION = {
  initial: false,
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} as const;
const NUMBER_CONTAINER_CLASS = "relative inline-flex whitespace-nowrap";
const lastFormattedByTransitionKey = new Map<string, string>();

export interface AnimatedNumberProps {
  value: number;
  format: Intl.NumberFormatOptions;
  /** Stable identity for one visual number slot across value changes. */
  transitionKey: string;
  revealed?: boolean;
}

export function AnimatedNumber({
  value,
  format,
  transitionKey,
  revealed = true,
}: AnimatedNumberProps) {
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
    () => lastFormattedByTransitionKey.get(transitionKey) ?? formatted,
    () => formatted,
  );
  const [advancedTo, setAdvancedTo] = useState<string | null>(null);
  const isCarryingPreviousValue = previousFormatted !== formatted && advancedTo !== formatted;
  const visualFormatted = isCarryingPreviousValue ? previousFormatted : formatted;
  const tokens = getAnimatedNumberTokensFromFormatted(visualFormatted);

  useEffect(() => {
    lastFormattedByTransitionKey.set(transitionKey, formatted);
    if (!isCarryingPreviousValue) return;

    const frame = requestAnimationFrame(() => setAdvancedTo(formatted));
    return () => cancelAnimationFrame(frame);
  }, [formatted, isCarryingPreviousValue, transitionKey]);

  if (!hydrated || shouldReduceMotion) {
    return <span className={NUMBER_CONTAINER_CLASS}>{formatted}</span>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <span className={NUMBER_CONTAINER_CLASS}>
        <span className="sr-only">{formatted}</span>
        <m.span aria-hidden className="inline-flex">
          <AnimatePresence mode="popLayout">
            {tokens.map(({ character, motionIndex, slotFromRight }) => {
              const isAnimatedGlyph = motionIndex !== null;
              const characterMotion = isAnimatedGlyph
                ? getAnimatedNumberGlyphMotionProps(false, motionIndex)
                : STATIC_CHARACTER_MOTION;
              const shouldShowCharacter = revealed || isCarryingPreviousValue;
              const hiddenCharacter = isAnimatedGlyph ? HIDDEN_BELOW : { opacity: 0 };
              return (
                <m.span
                  layout="position"
                  transition={{ layout: NUMBER_LAYOUT_TRANSITION }}
                  className="relative inline-grid overflow-hidden"
                  exit={NUMBER_REMOVED_CHARACTER_EXIT}
                  key={`slot-${slotFromRight}`}
                >
                  <AnimatePresence>
                    <m.span
                      {...characterMotion}
                      animate={shouldShowCharacter ? characterMotion.animate : hiddenCharacter}
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
