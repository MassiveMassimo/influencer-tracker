import type { Call } from "./types";

export type CallActivityLevel = 0 | 1 | 2 | 3 | 4;

export interface CallActivityDay {
  date: string;
  count: number;
}

export interface CallActivityCell extends CallActivityDay {
  level: CallActivityLevel;
}

export interface CallActivityWeek {
  month: string | null;
  days: (CallActivityCell | null)[];
}

export interface CallActivityCalendar {
  rangeStart: string;
  rangeEnd: string;
  weeks: CallActivityWeek[];
  activeDays: number;
  busiest: CallActivityDay | null;
}

const DAY_MS = 86_400_000;
const RANGE_DAYS = 365;
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

function parseIsoDay(date: string): Date {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function aggregateCallActivity(calls: readonly Pick<Call, "postDate">[]): CallActivityDay[] {
  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.postDate, (counts.get(call.postDate) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

export function activityLevel(count: number): CallActivityLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 7) return 3;
  return 4;
}

export function buildCallActivityCalendar(
  activity: readonly CallActivityDay[],
  generatedAt: string,
): CallActivityCalendar {
  const rangeEndDate = parseIsoDay(generatedAt);
  const rangeStartDate = addDays(rangeEndDate, -(RANGE_DAYS - 1));
  const gridStart = addDays(rangeStartDate, -rangeStartDate.getUTCDay());
  const gridEnd = addDays(rangeEndDate, 6 - rangeEndDate.getUTCDay());
  const rangeStart = isoDay(rangeStartDate);
  const rangeEnd = isoDay(rangeEndDate);

  const counts = new Map<string, number>();
  for (const day of activity) {
    counts.set(day.date, (counts.get(day.date) ?? 0) + day.count);
  }

  const weeks: CallActivityWeek[] = [];
  let activeDays = 0;
  let busiest: CallActivityDay | null = null;
  let previousMonth = "";

  for (let weekStart = gridStart; weekStart <= gridEnd; weekStart = addDays(weekStart, 7)) {
    const days: (CallActivityCell | null)[] = [];
    let month: string | null = null;

    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(weekStart, offset);
      const key = isoDay(date);
      if (key < rangeStart || key > rangeEnd) {
        days.push(null);
        continue;
      }

      const count = counts.get(key) ?? 0;
      days.push({ date: key, count, level: activityLevel(count) });
      if (count > 0) {
        activeDays++;
        if (busiest == null || count > busiest.count) busiest = { date: key, count };
      }

      if (month == null) {
        const monthKey = key.slice(0, 7);
        if (monthKey !== previousMonth) {
          month = MONTH_FORMAT.format(date);
          previousMonth = monthKey;
        }
      }
    }

    weeks.push({ month, days });
  }

  return { rangeStart, rangeEnd, weeks, activeDays, busiest };
}
