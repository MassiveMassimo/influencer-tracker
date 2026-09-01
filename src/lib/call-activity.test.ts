import { describe, expect, test } from "bun:test";
import { activityLevel, aggregateCallActivity, buildCallActivityCalendar } from "./call-activity";

describe("aggregateCallActivity", () => {
  test("counts calls by ISO day and sorts the compact result", () => {
    expect(
      aggregateCallActivity([
        { postDate: "2026-08-03" },
        { postDate: "2026-08-01" },
        { postDate: "2026-08-03" },
      ]),
    ).toEqual([
      { date: "2026-08-01", count: 1 },
      { date: "2026-08-03", count: 2 },
    ]);
  });
});

describe("activityLevel", () => {
  test("uses fixed thresholds that remain comparable across creators", () => {
    expect([0, 1, 2, 3, 4, 7, 8, 80].map(activityLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("buildCallActivityCalendar", () => {
  test("builds an exact 365-day range ending on the data date", () => {
    const calendar = buildCallActivityCalendar(
      [
        { date: "2025-08-25", count: 9 },
        { date: "2025-08-26", count: 1 },
        { date: "2026-08-25", count: 8 },
        { date: "2026-08-26", count: 9 },
      ],
      "2026-08-25T00:00:00Z",
    );

    const visible = calendar.weeks.flatMap((week) => week.days).filter((day) => day != null);

    expect(calendar.rangeStart).toBe("2025-08-26");
    expect(calendar.rangeEnd).toBe("2026-08-25");
    expect(visible).toHaveLength(365);
    expect(visible[0]).toMatchObject({ date: "2025-08-26", count: 1, level: 1 });
    expect(visible.at(-1)).toMatchObject({ date: "2026-08-25", count: 8, level: 4 });
    expect(visible.some((day) => day.date === "2025-08-25")).toBe(false);
    expect(visible.some((day) => day.date === "2026-08-26")).toBe(false);
  });

  test("pads complete Sunday-to-Saturday columns and reports summary data", () => {
    const calendar = buildCallActivityCalendar(
      [
        { date: "2026-08-23", count: 2 },
        { date: "2026-08-25", count: 5 },
      ],
      "2026-08-25",
    );

    expect(calendar.weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(calendar.weeks.at(-1)?.days.map((day) => day?.date ?? null)).toEqual([
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
      null,
      null,
      null,
      null,
    ]);
    expect(calendar.activeDays).toBe(2);
    expect(calendar.busiest).toEqual({ date: "2026-08-25", count: 5 });
  });
});
