import { test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertScrapeCoverage,
  forwardCaughtUp,
  knownShortcodes,
  profileReelShortcodes,
} from "./scrape-forward";
import { DATA } from "./config";

test("forwardCaughtUp: stops only after a known target reel was observed", () => {
  // Not enough known-only rounds yet -> keep scrolling (clears pinned reels, reaches new ones).
  expect(forwardCaughtUp({ knownOnlyRounds: 2, patience: 3, observedKnown: true })).toBe(false);
  expect(forwardCaughtUp({ knownOnlyRounds: 3, patience: 3, observedKnown: true })).toBe(true);
  // The old implementation treated three empty rounds as success.
  expect(forwardCaughtUp({ knownOnlyRounds: 5, patience: 3, observedKnown: false })).toBe(false);
});

test("profileReelShortcodes: accepts only reel links attributed to the target profile", () => {
  expect(
    profileReelShortcodes(
      [
        "/kevvonz/reel/TARGET1/",
        "https://www.instagram.com/kevvonz/reel/TARGET2/?utm_source=test",
        "/someone_else/reel/FOREIGN/",
        "/reel/GLOBAL/",
        "/kevvonz/p/IMAGE/",
        "/kevvonz/reel/TARGET1/",
      ],
      "kevvonz",
    ),
  ).toEqual(["TARGET1", "TARGET2"]);
});

test("assertScrapeCoverage: rejects empty and unanchored forward scrapes", () => {
  expect(() => assertScrapeCoverage({ seenCount: 0, forward: true, observedKnown: false })).toThrow(
    /zero target-profile reels/,
  );
  expect(() => assertScrapeCoverage({ seenCount: 4, forward: true, observedKnown: false })).toThrow(
    /never reached a known target-profile reel/,
  );
  expect(() =>
    assertScrapeCoverage({ seenCount: 4, forward: true, observedKnown: true }),
  ).not.toThrow();
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
