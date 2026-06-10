import { describe, expect, test } from "bun:test";
import { relativeTime } from "./relative-time";

const now = new Date("2026-06-10T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;
const DAY = 24 * HR;

describe("relativeTime", () => {
  test("under a minute is 'just now'", () => {
    expect(relativeTime(ago(0), now)).toBe("just now");
    expect(relativeTime(ago(59 * SEC), now)).toBe("just now");
  });

  test("minutes (singular and plural)", () => {
    expect(relativeTime(ago(1 * MIN), now)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * MIN), now)).toBe("5 minutes ago");
    expect(relativeTime(ago(59 * MIN), now)).toBe("59 minutes ago");
  });

  test("hours (the 6h SWR window reads as hours)", () => {
    expect(relativeTime(ago(1 * HR), now)).toBe("1 hour ago");
    expect(relativeTime(ago(3 * HR), now)).toBe("3 hours ago");
    expect(relativeTime(ago(23 * HR), now)).toBe("23 hours ago");
  });

  test("days", () => {
    expect(relativeTime(ago(1 * DAY), now)).toBe("1 day ago");
    expect(relativeTime(ago(5 * DAY), now)).toBe("5 days ago");
    expect(relativeTime(ago(29 * DAY), now)).toBe("29 days ago");
  });

  test("months and years", () => {
    expect(relativeTime(ago(30 * DAY), now)).toBe("1 month ago");
    expect(relativeTime(ago(90 * DAY), now)).toBe("3 months ago");
    expect(relativeTime(ago(365 * DAY), now)).toBe("1 year ago");
  });

  test("future timestamps (clock skew) clamp to 'just now'", () => {
    expect(relativeTime(ago(-5 * MIN), now)).toBe("just now");
  });
});
