import { test, expect } from "bun:test";
import { buildLineChartBackgroundSvg } from "./card-bg";
import { palette } from "./theme";

const base = { theme: "dark" as const, palette: palette("dark"), width: 1200, height: 630 };

test("renders an svg with a line path for a normal series", () => {
  const svg = buildLineChartBackgroundSvg({ ...base, closes: [10, 12, 11, 15, 14], up: true });
  expect(svg).toContain("<svg");
  expect(svg).toContain("<path");
});

test("handles empty closes without crashing (no line, still valid svg)", () => {
  const svg = buildLineChartBackgroundSvg({ ...base, closes: [], up: true });
  expect(svg.startsWith("<svg")).toBe(true);
});

test("handles a single point", () => {
  const svg = buildLineChartBackgroundSvg({ ...base, closes: [42], up: false });
  expect(svg).toContain("<svg");
});
