"use client";

import { AnimatePresence, domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useSyncExternalStore } from "react";
import { usePreferences } from "#/lib/preferences.tsx";
import {
  getAnimatedNumberTokens,
  getStatDigitMotionProps,
  HIDDEN_BELOW,
} from "./animated-stat-number-motion.ts";

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function AnimatedStatNumber({
  value,
  format,
  revealed,
}: {
  value: number;
  format: Intl.NumberFormatOptions;
  revealed: boolean;
}) {
  const osReduceMotion = useReducedMotion() === true;
  const { reduceMotion } = usePreferences();
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const reduce = osReduceMotion || reduceMotion;
  const tokens = getAnimatedNumberTokens(value, format);
  const formatted = tokens.map(({ character }) => character).join("");

  if (!mounted || reduce) {
    return <span>{formatted}</span>;
  }

  return (
    <LazyMotion features={domAnimation}>
      <span className="inline-flex whitespace-nowrap">
        <span className="sr-only">{formatted}</span>
        <span aria-hidden className="inline-flex">
          {tokens.map((token, characterIndex) => {
            if (token.digitIndex === null) {
              return <span key={`static-${characterIndex}`}>{token.character}</span>;
            }

            const motionProps = getStatDigitMotionProps(false, token.digitIndex);
            return (
              <span
                className="relative inline-grid overflow-hidden"
                key={`digit-${token.digitIndex}`}
              >
                <AnimatePresence>
                  <m.span
                    {...motionProps}
                    animate={revealed ? motionProps.animate : HIDDEN_BELOW}
                    className="col-start-1 row-start-1 inline-block"
                    key={token.character}
                  >
                    {token.character}
                  </m.span>
                </AnimatePresence>
              </span>
            );
          })}
        </span>
      </span>
    </LazyMotion>
  );
}
