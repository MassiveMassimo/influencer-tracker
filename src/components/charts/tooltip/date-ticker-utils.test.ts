import { describe, it, expect } from "bun:test";
import {
  isTimeLabel,
  tickerMode,
  splitLabel,
  buildSegments,
  segmentIndexFor,
} from "./date-ticker-utils.ts";

describe("splitLabel / mode", () => {
  it("splits a date label into month + day", () => {
    expect(splitLabel("Jun 3")).toEqual(["Jun", "3"]);
    expect(isTimeLabel("Jun 3")).toBe(false);
  });

  it("splits a time label into hour + minute", () => {
    expect(splitLabel("09:30")).toEqual(["09", "30"]);
    expect(isTimeLabel("09:30")).toBe(true);
  });

  it("detects mode from the label set", () => {
    expect(tickerMode(["Jun 3", "Jun 4"])).toBe("date");
    expect(tickerMode(["09:30", "09:35"])).toBe("time");
  });
});

describe("buildSegments", () => {
  it("collapses consecutive equal values into one run each", () => {
    // Intraday day-of-month: every bar is "3" — must be a single run, not 4.
    expect(buildSegments(["3", "3", "3", "3"])).toEqual([
      { value: "3", startIndex: 0, key: "3-0" },
    ]);
  });

  it("starts a new run only when the value changes", () => {
    expect(buildSegments(["Jun", "Jun", "Jul", "Jul", "Aug"])).toEqual([
      { value: "Jun", startIndex: 0, key: "Jun-0" },
      { value: "Jul", startIndex: 2, key: "Jul-2" },
      { value: "Aug", startIndex: 4, key: "Aug-4" },
    ]);
  });

  it("keeps non-consecutive repeats as distinct runs", () => {
    // minute 00 at two different hours is two runs
    expect(buildSegments(["00", "30", "00"]).map((s) => s.startIndex)).toEqual([0, 1, 2]);
  });
});

describe("segmentIndexFor", () => {
  const segs = buildSegments(["Jun", "Jun", "Jul", "Aug"]);
  it("returns the run containing the current bar", () => {
    expect(segmentIndexFor(segs, 0)).toBe(0); // Jun
    expect(segmentIndexFor(segs, 1)).toBe(0); // still Jun
    expect(segmentIndexFor(segs, 2)).toBe(1); // Jul
    expect(segmentIndexFor(segs, 3)).toBe(2); // Aug
  });
  it("clamps out-of-range to the first run", () => {
    expect(segmentIndexFor(segs, -1)).toBe(0);
  });
});
