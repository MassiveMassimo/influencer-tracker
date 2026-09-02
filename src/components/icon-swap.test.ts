import { describe, expect, test } from "bun:test";
import { getIconSwapPositionProps } from "./icon-swap.tsx";

describe("IconSwap", () => {
  test("keeps position animation enabled by default", () => {
    expect(getIconSwapPositionProps(true)).toEqual({
      layout: "position",
      transition: {
        duration: 0.18,
        ease: [0.23, 1, 0.32, 1],
      },
    });
  });

  test("can leave position changes to its surrounding text animation", () => {
    expect(getIconSwapPositionProps(false)).toEqual({});
  });
});
