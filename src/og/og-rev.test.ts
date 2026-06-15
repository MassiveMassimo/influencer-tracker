import { test, expect } from "bun:test";
import { ogRev } from "./og-rev";

test("ogRev is stable for identical inputs", () => {
  expect(ogRev([0.124, 42])).toBe(ogRev([0.124, 42]));
});

test("ogRev changes when any field changes", () => {
  expect(ogRev([0.124, 42])).not.toBe(ogRev([0.125, 42]));
  expect(ogRev([0.124, 42])).not.toBe(ogRev([0.124, 43]));
});

test("ogRev tolerates null/undefined and returns 8 hex chars", () => {
  expect(ogRev([null, undefined])).toMatch(/^[0-9a-f]{8}$/);
});
