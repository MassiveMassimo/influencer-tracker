import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { forwardCaughtUp, knownShortcodes } from "./scrape-forward";
import { DATA } from "./config";

test("forwardCaughtUp: stops after `patience` consecutive known-only rounds", () => {
  // Not enough known-only rounds yet -> keep scrolling (clears pinned reels, reaches new ones).
  expect(forwardCaughtUp({ knownOnlyRounds: 2, patience: 3 })).toBe(false);
  // patience reached -> caught up. Fires whether or not new reels were seen, so a zero-new
  // day exits promptly instead of scrolling toward the 12-month cutoff.
  expect(forwardCaughtUp({ knownOnlyRounds: 3, patience: 3 })).toBe(true);
  expect(forwardCaughtUp({ knownOnlyRounds: 5, patience: 3 })).toBe(true);
});

test("knownShortcodes: reads transcript basenames, empty when dir missing", () => {
  const handle = `__test_known_${Date.now()}`;
  const dir = join(DATA, handle, "transcripts");
  // missing dir -> empty
  expect(knownShortcodes(handle).size).toBe(0);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "ABC123.json"), "{}");
    writeFileSync(join(dir, "DEF456.json"), "{}");
    writeFileSync(join(dir, "notjson.txt"), "x");
    const got = knownShortcodes(handle);
    expect(got.has("ABC123")).toBe(true);
    expect(got.has("DEF456")).toBe(true);
    expect(got.has("notjson")).toBe(false);
    expect(got.size).toBe(2);
  } finally {
    rmSync(join(DATA, handle), { recursive: true, force: true });
  }
});
