import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { AnimatedStatNumber } from "./animated-stat-number.tsx";
import {
  getAnimatedNumberTokens,
  getStatDigitMotionProps,
  STAT_LAYOUT_TRANSITION,
  STAT_REMOVED_CHARACTER_EXIT,
} from "./animated-stat-number-motion.ts";

describe("animated stat number", () => {
  test("keeps punctuation static while identifying each numeric glyph", () => {
    expect(
      getAnimatedNumberTokens(2159, {
        maximumFractionDigits: 0,
      }),
    ).toEqual([
      { character: "2", digitIndex: 0, slotFromRight: 4 },
      { character: ",", digitIndex: null, slotFromRight: 3 },
      { character: "1", digitIndex: 1, slotFromRight: 2 },
      { character: "5", digitIndex: 2, slotFromRight: 1 },
      { character: "9", digitIndex: 3, slotFromRight: 0 },
    ]);
  });

  test("keeps trailing character slots stable when the number gets shorter", () => {
    const long = getAnimatedNumberTokens(2961, { maximumFractionDigits: 0 });
    const short = getAnimatedNumberTokens(116, { maximumFractionDigits: 0 });

    expect(long.at(-1)).toEqual({
      character: "1",
      digitIndex: 3,
      slotFromRight: 0,
    });
    expect(short.at(-1)).toEqual({
      character: "6",
      digitIndex: 2,
      slotFromRight: 0,
    });
  });

  test("uses the intake digit motion with a four-pixel blur", () => {
    const props = getStatDigitMotionProps(false, 2);

    expect(props.initial).toEqual({
      opacity: 0,
      y: "0.42em",
      scale: 0.6,
      filter: "blur(4px)",
    });
    expect(props.animate.transition.y).toMatchObject({
      duration: 0.5,
      delay: 0.16,
      ease: [0.3, 0.4, 0.1, 1.25],
    });
    expect(props.exit).toMatchObject({
      opacity: 0,
      y: "-0.42em",
      scale: 0.6,
      filter: "blur(4px)",
    });
  });

  test("matches width changes to the digit glyph timing", () => {
    const digitTransition = getStatDigitMotionProps(false, 0).animate.transition.scale;
    if (!digitTransition) throw new Error("Digit scale transition is missing");

    expect({
      duration: digitTransition.duration,
      ease: digitTransition.ease,
    }).toEqual(STAT_LAYOUT_TRANSITION);
  });

  test("gives removed punctuation the same graceful exit as removed digits", () => {
    expect(STAT_REMOVED_CHARACTER_EXIT).toMatchObject({
      opacity: 0,
      y: "-0.42em",
      scale: 0.6,
      filter: "blur(4px)",
      transition: {
        duration: 0.6,
      },
    });
  });

  test("removes transitions when reduced motion is active", () => {
    const props = getStatDigitMotionProps(true, 1);

    expect(props.initial).toBeFalse();
    expect(props.animate.transition).toEqual({ duration: 0 });
    expect(props.exit.transition).toEqual({ duration: 0 });
  });

  test("keeps the formatted value visible before client hydration", () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AnimatedStatNumber
          format={{ maximumFractionDigits: 0 }}
          layoutKey="Total calls"
          revealed={false}
          value={2159}
        />
      </PreferencesProvider>,
    );

    expect(html).toContain(">2,159<");
    expect(html).not.toContain("opacity:0");
  });
});
