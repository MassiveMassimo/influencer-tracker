const DIGIT_STAGGER_SECONDS = 0.08;
const DIGIT_MOTION_DURATION_SECONDS = 0.5;
const Y_EASE = [0.3, 0.4, 0.1, 1.25] as const;
const GLYPH_EASE = [0.3, 0.4, 0.4, 1] as const;
const EXIT_EASE = [0.3, 0.4, 0.1, 1] as const;

export const STAT_LAYOUT_TRANSITION = {
  duration: DIGIT_MOTION_DURATION_SECONDS,
  ease: GLYPH_EASE,
} as const;

export const HIDDEN_BELOW = {
  opacity: 0,
  y: "0.42em",
  scale: 0.6,
  filter: "blur(4px)",
} as const;

const VISIBLE = {
  opacity: 1,
  y: "0em",
  scale: 1,
  filter: "blur(0px)",
} as const;

const HIDDEN_ABOVE = {
  opacity: 0,
  y: "-0.42em",
  scale: 0.6,
  filter: "blur(4px)",
} as const;

export const STAT_REMOVED_CHARACTER_EXIT = {
  ...HIDDEN_ABOVE,
  transition: {
    duration: 0.6,
    ease: EXIT_EASE,
    opacity: { duration: 0.55, ease: EXIT_EASE },
  },
} as const;

export function getStatDigitMotionProps(
  reduceMotion: boolean,
  motionIndex: number,
  phase: "reveal" | "change" = "reveal",
) {
  const motionDelay = motionIndex * DIGIT_STAGGER_SECONDS;
  const visibilityDelay = phase === "reveal" ? motionDelay : 0;

  return {
    initial: reduceMotion ? false : HIDDEN_BELOW,
    animate: {
      ...VISIBLE,
      transition: reduceMotion
        ? { duration: 0 }
        : {
            y: {
              type: "tween",
              duration: DIGIT_MOTION_DURATION_SECONDS,
              delay: motionDelay,
              ease: Y_EASE,
            },
            scale: {
              type: "tween",
              duration: DIGIT_MOTION_DURATION_SECONDS,
              delay: motionDelay,
              ease: GLYPH_EASE,
            },
            filter: {
              type: "tween",
              duration: DIGIT_MOTION_DURATION_SECONDS,
              delay: motionDelay,
              ease: GLYPH_EASE,
            },
            opacity: { duration: 0.35, delay: visibilityDelay, ease: "easeOut" },
          },
    },
    exit: {
      ...(reduceMotion ? VISIBLE : HIDDEN_ABOVE),
      transition: reduceMotion
        ? { duration: 0 }
        : {
            duration: 0.6,
            delay: visibilityDelay,
            ease: EXIT_EASE,
            opacity: { duration: 0.55, delay: visibilityDelay, ease: EXIT_EASE },
          },
    },
  } as const;
}

interface AnimatedNumberToken {
  character: string;
  motionIndex: number | null;
  slotFromRight: number;
}

export function formatAnimatedNumber(value: number, format: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("en-US", format).format(value);
}

export function getAnimatedNumberTokensFromFormatted(formatted: string): AnimatedNumberToken[] {
  let motionIndex = 0;
  const characters = Array.from(formatted);
  return characters.map((character, characterIndex) => ({
    character,
    motionIndex: /[\p{Number},.]/u.test(character) ? motionIndex++ : null,
    slotFromRight: characters.length - characterIndex - 1,
  }));
}
