import { describe, expect, test } from "bun:test";
import type { CallIndexEntry } from "./call-index";
import { EXPLORE_INITIAL_CALLS, buildExploreInitialData } from "./explore-data";

function row(index: number): CallIndexEntry {
  return {
    handle: "creator",
    shortcode: `post-${index}`,
    ticker: `T${index}`,
    company: `Company ${index}`,
    postDate: "2026-08-25",
    isFirstCall: true,
    conviction: 0.5,
    ex3m: null,
    exToDate: null,
    stockToDate: null,
  };
}

describe("buildExploreInitialData", () => {
  test("returns a bounded initial window and the complete count", () => {
    const calls = Array.from({ length: EXPLORE_INITIAL_CALLS + 7 }, (_, index) => row(index));

    const initial = buildExploreInitialData(calls);

    expect(initial.calls).toHaveLength(EXPLORE_INITIAL_CALLS);
    expect(initial.totalCalls).toBe(calls.length);
    expect(initial.calls[0]).toBe(calls[0]);
    expect(initial.calls.at(-1)).toBe(calls[EXPLORE_INITIAL_CALLS - 1]);
  });

  test("does not mutate or pad a short index", () => {
    const calls = [row(0), row(1)];
    const original = [...calls];

    expect(buildExploreInitialData(calls)).toEqual({ calls, totalCalls: 2 });
    expect(calls).toEqual(original);
  });
});
