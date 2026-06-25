// scripts/shortcodes.test.ts
import { test, expect } from "bun:test";
import { majorityNumeric, loadShortcodes } from "./shortcodes";

test("majorityNumeric: X tweet ids vs IG reel codes", () => {
  expect(majorityNumeric(["2068305592083423341", "1973870591154565292"])).toBe(true);
  expect(majorityNumeric(["DVwrHDSEWGm", "DOPcBQAD6Qo", "DLsPCEgR4p-"])).toBe(false);
  // mixed: 1 numeric of 3 -> not majority numeric (treat as IG)
  expect(majorityNumeric(["123456", "DVwrHDSEWGm", "DOPcBQAD6Qo"])).toBe(false);
  // empty -> false (no signal; do not skip)
  expect(majorityNumeric([])).toBe(false);
});

test("loadShortcodes: missing reel-calls.json -> [] (handle then treated as IG, the safe direction)", async () => {
  const codes = await loadShortcodes(`__no_such_handle_${Date.now()}`);
  expect(codes).toEqual([]);
  // A fresh checkout with no reel-calls.json must NOT be mistaken for an X handle and skipped.
  expect(majorityNumeric(codes)).toBe(false);
});
