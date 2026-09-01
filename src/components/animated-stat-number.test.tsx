import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { AnimatedStatNumber } from "./animated-stat-number.tsx";
import {
  formatAnimatedNumber,
  getAnimatedNumberTokensFromFormatted,
  getStatGlyphMotionProps,
  STAT_LAYOUT_TRANSITION,
  STAT_REMOVED_CHARACTER_EXIT,
} from "./animated-stat-number-motion.ts";

const getTokens = (value: number, format: Intl.NumberFormatOptions) =>
  getAnimatedNumberTokensFromFormatted(formatAnimatedNumber(value, format));

describe("animated stat number", () => {
  test("gives punctuation the same motion sequence as numeric glyphs", () => {
    expect(
      getTokens(2159, {
        maximumFractionDigits: 0,
      }),
    ).toEqual([
      { character: "2", motionIndex: 0, slotFromRight: 4 },
      { character: ",", motionIndex: 1, slotFromRight: 3 },
      { character: "1", motionIndex: 2, slotFromRight: 2 },
      { character: "5", motionIndex: 3, slotFromRight: 1 },
      { character: "9", motionIndex: 4, slotFromRight: 0 },
    ]);
    expect(
      getTokens(8.9, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    ).toEqual([
      { character: "8", motionIndex: 0, slotFromRight: 2 },
      { character: ".", motionIndex: 1, slotFromRight: 1 },
      { character: "9", motionIndex: 2, slotFromRight: 0 },
    ]);
    expect(
      getTokens(-0.05, {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    ).toEqual([
      { character: "-", motionIndex: null, slotFromRight: 4 },
      { character: "5", motionIndex: 0, slotFromRight: 3 },
      { character: ".", motionIndex: 1, slotFromRight: 2 },
      { character: "0", motionIndex: 2, slotFromRight: 1 },
      { character: "%", motionIndex: null, slotFromRight: 0 },
    ]);
  });

  test("keeps trailing character slots stable when the number gets shorter", () => {
    const long = getTokens(2961, { maximumFractionDigits: 0 });
    const short = getTokens(116, { maximumFractionDigits: 0 });

    expect(long.at(-1)).toEqual({
      character: "1",
      motionIndex: 4,
      slotFromRight: 0,
    });
    expect(short.at(-1)).toEqual({
      character: "6",
      motionIndex: 2,
      slotFromRight: 0,
    });
  });

  test("uses the intake digit motion with a four-pixel blur", () => {
    const props = getStatGlyphMotionProps(false, 2);

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

  test("matches character position changes to the digit glyph timing", () => {
    const digitTransition = getStatGlyphMotionProps(false, 0).animate.transition.scale;
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
    const props = getStatGlyphMotionProps(true, 1);

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
