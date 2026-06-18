import { test, expect } from "bun:test";
import { timelineXPercent, timelineTicks } from "./call-timeline-layout";

const start = Date.UTC(2026, 0, 1); // 2026-01-01
const end = Date.UTC(2026, 11, 31); // 2026-12-31

test("xPercent maps start->0, end->100, midpoint->~50", () => {
  expect(timelineXPercent(start, start, end)).toBe(0);
  expect(timelineXPercent(end, start, end)).toBe(100);
  const mid = start + (end - start) / 2;
  expect(Math.round(timelineXPercent(mid, start, end))).toBe(50);
});

test("xPercent clamps out-of-range and handles zero-width", () => {
  expect(timelineXPercent(start - 1e9, start, end)).toBe(0);
  expect(timelineXPercent(end + 1e9, start, end)).toBe(100);
  expect(timelineXPercent(start, start, start)).toBe(50);
});

test("ticks return start/mid/end with YYYY-MM labels and pct 0/50/100", () => {
  const ticks = timelineTicks(start, end);
  expect(ticks.map((t) => t.pct)).toEqual([0, 50, 100]);
  expect(ticks[0].label).toBe("2026-01");
  expect(ticks[2].label).toBe("2026-12");
});
