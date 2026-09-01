import { describe, expect, test } from "bun:test";
import { createScrubSoundController } from "./interface-sounds.ts";

describe("createScrubSoundController", () => {
  test("plays the selected scrub sound", () => {
    const played: string[] = [];
    const scrub = createScrubSoundController({
      minIntervalMs: 0,
      sound: "release",
      playSound: (sound) => played.push(sound),
    });

    scrub.move("2026-08-01", 0);

    expect(played).toEqual(["release"]);
  });

  test("plays once when the scrub key changes", () => {
    const played: string[] = [];
    const scrub = createScrubSoundController({
      minIntervalMs: 0,
      playSound: () => played.push("tick"),
    });

    expect(scrub.move("2026-08-01", 0)).toBe(true);
    expect(scrub.move("2026-08-01", 10)).toBe(false);
    expect(scrub.move("2026-08-02", 20)).toBe(true);
    expect(played).toEqual(["tick", "tick"]);
  });

  test("rate-limits rapid key changes without queuing audio", () => {
    const played: string[] = [];
    const scrub = createScrubSoundController({
      minIntervalMs: 40,
      playSound: () => played.push("tick"),
    });

    expect(scrub.move(1, 0)).toBe(true);
    expect(scrub.move(2, 20)).toBe(false);
    expect(scrub.move(3, 39)).toBe(false);
    expect(scrub.move(4, 40)).toBe(true);
    expect(played).toEqual(["tick", "tick"]);
  });

  test("reset lets the same key cue a new scrub session", () => {
    const played: string[] = [];
    const scrub = createScrubSoundController({
      minIntervalMs: 0,
      playSound: () => played.push("tick"),
    });

    scrub.move("point-a", 0);
    scrub.reset();

    expect(scrub.move("point-a", 1)).toBe(true);
    expect(played).toEqual(["tick", "tick"]);
  });
});
