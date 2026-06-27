import { test, expect } from "bun:test";
import { smoothPath } from "./svg-smooth";

test("empty for fewer than 2 points", () => {
  expect(smoothPath([])).toBe("");
  expect(smoothPath([{ x: 0, y: 0 }])).toBe("");
});

test("two points draw a straight line", () => {
  expect(
    smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
    ]),
  ).toBe("M0,0 L10,5");
});

test("three+ points produce cubic segments starting at first point", () => {
  const d = smoothPath([
    { x: 0, y: 0 },
    { x: 5, y: 10 },
    { x: 10, y: 0 },
  ]);
  expect(d.startsWith("M0,0")).toBe(true);
  expect(d.includes("C")).toBe(true);
});
