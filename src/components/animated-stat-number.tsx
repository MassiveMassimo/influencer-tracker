"use client";

import { AnimatePresence, domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
type CharacterExitTarget =
  | ReturnType<typeof getStatDigitMotionProps>["exit"]
  | (typeof STATIC_CHARACTER_MOTION)["exit"];
const CHARACTER_EXIT_VARIANTS = {
  exit: (target: CharacterExitTarget) => target,
} as const;
const STAT_LAYOUT_CSS_TRANSITION = {
  transitionDuration: `${STAT_LAYOUT_TRANSITION.duration}s`,
  transitionTimingFunction: `cubic-bezier(${STAT_LAYOUT_TRANSITION.ease.join(", ")})`,
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
  const [numberWidth, setNumberWidth] = useState<{
    animate: boolean;
    visualOffset: number;
    value: number | null;
  }>({
    animate: false,
    visualOffset: 0,
    value: null,
  });
  const previousMeasurementRef = useRef<HTMLSpanElement>(null);
  const targetMeasurementRef = useRef<HTMLSpanElement>(null);
  const measuredWidthPairRef = useRef("");
  const previousFormattedSnapshot = useSyncExternalStore(
    subscribeToNoopStore,
    () => lastFormattedByLayoutKey.get(layoutKey) ?? formatted,
    () => formatted,
  );
  const [transitionSource, setTransitionSource] = useState({
    from: previousFormattedSnapshot,
    target: formatted,
  });
  const previousFormatted =
    transitionSource.target === formatted ? transitionSource.from : previousFormattedSnapshot;
  useLayoutEffect(() => {
    if (transitionSource.target === formatted) return;
    setTransitionSource({
      from: previousFormattedSnapshot,
      target: formatted,
    });
  }, [formatted, previousFormattedSnapshot, transitionSource.target]);
  const [advancedTo, setAdvancedTo] = useState<string | null>(null);
  const isCarryingPreviousValue = previousFormatted !== formatted && advancedTo !== formatted;
  const visualFormatted = isCarryingPreviousValue ? previousFormatted : formatted;
  const tokens = getAnimatedNumberTokensFromFormatted(visualFormatted);

  useLayoutEffect(() => {
    const previousMeasurement = previousMeasurementRef.current;
    const targetMeasurement = targetMeasurementRef.current;
    if (!previousMeasurement || !targetMeasurement) return;
    let widthFrame: number | null = null;

    const updateWidth = () => {
      const previousWidth =
        Math.round(previousMeasurement.getBoundingClientRect().width * 100) / 100;
      const targetWidth = Math.round(targetMeasurement.getBoundingClientRect().width * 100) / 100;
      const measuredWidthPair = `${previousWidth}:${targetWidth}`;
      if (measuredWidthPairRef.current === measuredWidthPair) return;
      measuredWidthPairRef.current = measuredWidthPair;

      const isContracting = previousWidth > targetWidth;
      setNumberWidth({
        animate: false,
        visualOffset: isContracting ? 0 : previousWidth - targetWidth,
        value: previousWidth,
      });
      if (previousWidth === targetWidth || shouldReduceMotion) {
        setNumberWidth({ animate: false, visualOffset: 0, value: targetWidth });
        return;
      }

      widthFrame = requestAnimationFrame(() => {
        widthFrame = requestAnimationFrame(() => {
          setNumberWidth({
            animate: true,
            visualOffset: isContracting ? targetWidth - previousWidth : 0,
            value: targetWidth,
          });
        });
      });
    };
    const observer = new ResizeObserver(updateWidth);

    updateWidth();
    observer.observe(previousMeasurement);
    observer.observe(targetMeasurement);

    return () => {
      if (widthFrame !== null) cancelAnimationFrame(widthFrame);
      observer.disconnect();
    };
  }, [formatted, previousFormatted, shouldReduceMotion]);

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
      <span
        className={`${NUMBER_CONTAINER_CLASS} min-w-0 shrink-0 justify-start`}
        data-stat-number-width
        style={{
          ...STAT_LAYOUT_CSS_TRANSITION,
          transitionProperty: numberWidth.animate ? "width" : "none",
          width: numberWidth.value ?? undefined,
        }}
      >
        <span className="sr-only">{formatted}</span>
        <span
          ref={previousMeasurementRef}
          aria-hidden
          className="invisible absolute inline-flex w-max shrink-0"
        >
          {previousFormatted}
        </span>
        <span
          ref={targetMeasurementRef}
          aria-hidden
          className="invisible inline-flex w-max shrink-0"
        >
          {formatted}
        </span>
        <m.span
          aria-hidden
          className="absolute top-0 left-0 inline-flex"
          data-stat-number-visual
          style={{
            ...STAT_LAYOUT_CSS_TRANSITION,
            transform: `translateX(${numberWidth.visualOffset}px)`,
            transitionProperty: numberWidth.animate ? "transform" : "none",
          }}
        >
          <AnimatePresence
            onExitComplete={() =>
              setNumberWidth((current) => ({
                ...current,
                animate: false,
                visualOffset: 0,
              }))
            }
          >
            {tokens.map(({ character, digitIndex, slotFromRight }) => {
              const isDigit = digitIndex !== null;
              const characterMotion = isDigit
                ? getStatDigitMotionProps(false, digitIndex)
                : STATIC_CHARACTER_MOTION;
              const { exit: characterExit, ...characterMotionProps } = characterMotion;
              const shouldShowCharacter = !isDigit || revealed || isCarryingPreviousValue;
              return (
                <m.span
                  className="relative inline-grid overflow-hidden"
                  exit={STAT_REMOVED_CHARACTER_EXIT}
                  key={`slot-${slotFromRight}`}
                >
                  <AnimatePresence custom={characterExit}>
                    <m.span
                      {...characterMotionProps}
                      animate={shouldShowCharacter ? characterMotion.animate : HIDDEN_BELOW}
                      className="col-start-1 row-start-1 inline-block"
                      exit="exit"
                      key={character}
                      variants={CHARACTER_EXIT_VARIANTS}
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
