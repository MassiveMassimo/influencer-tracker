import { describe, expect, it } from "bun:test";
import { shouldFire } from "./haptics.tsx";

describe("shouldFire", () => {
  it("fires when supported and not reduced", () => {
    expect(shouldFire({ supported: true, reduceHaptics: false })).toBe(true);
  });
  it("no-op when reduced", () => {
    expect(shouldFire({ supported: true, reduceHaptics: true })).toBe(false);
  });
  it("no-op when unsupported", () => {
    expect(shouldFire({ supported: false, reduceHaptics: false })).toBe(false);
  });
});
