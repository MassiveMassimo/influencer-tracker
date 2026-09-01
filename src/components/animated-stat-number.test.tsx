import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "#/lib/preferences.tsx";
import { AnimatedStatNumber } from "./animated-stat-number.tsx";
import { getAnimatedNumberTokens, getStatDigitMotionProps } from "./animated-stat-number-motion.ts";

describe("animated stat number", () => {
  test("keeps punctuation static while identifying each numeric glyph", () => {
    expect(
      getAnimatedNumberTokens(2159, {
        maximumFractionDigits: 0,
      }),
    ).toEqual([
      { character: "2", digitIndex: 0 },
      { character: ",", digitIndex: null },
      { character: "1", digitIndex: 1 },
      { character: "5", digitIndex: 2 },
      { character: "9", digitIndex: 3 },
    ]);
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

  test("removes transitions when reduced motion is active", () => {
    const props = getStatDigitMotionProps(true, 1);

    expect(props.initial).toBeFalse();
    expect(props.animate.transition).toEqual({ duration: 0 });
    expect(props.exit.transition).toEqual({ duration: 0 });
  });

  test("keeps the formatted value visible before client hydration", () => {
    const html = renderToStaticMarkup(
      <PreferencesProvider>
        <AnimatedStatNumber format={{ maximumFractionDigits: 0 }} revealed={false} value={2159} />
      </PreferencesProvider>,
    );

    expect(html).toContain(">2,159<");
    expect(html).not.toContain("opacity:0");
  });
});
