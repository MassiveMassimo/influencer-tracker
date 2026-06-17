import { describe, expect, test } from "bun:test";
import { headlineReadout } from "./headline-readout.ts";

describe("headlineReadout", () => {
  test("no hover: uses last close, delta over first→last", () => {
    expect(headlineReadout(null, 100, 110)).toEqual({
      close: 110,
      delta: 10,
      change: 0.1,
    });
  });

  test("hover: uses hovered close, delta over first→hovered", () => {
    expect(headlineReadout(105, 100, 110)).toEqual({
      close: 105,
      delta: 5,
      change: 0.05,
    });
  });

  test("missing first close: delta and change null, close still resolves", () => {
    expect(headlineReadout(105, null, 110)).toEqual({
      close: 105,
      delta: null,
      change: null,
    });
  });

  test("no data at all: everything null", () => {
    expect(headlineReadout(null, null, null)).toEqual({
      close: null,
      delta: null,
      change: null,
    });
  });

  test("zero first close does not divide: change null", () => {
    expect(headlineReadout(null, 0, 110)).toEqual({
      close: 110,
      delta: 110,
      change: null,
    });
  });
});
