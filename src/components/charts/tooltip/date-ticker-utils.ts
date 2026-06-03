// Pure helpers for the crosshair date/time pill (`date-ticker.tsx`).
//
// A label is either a date ("Jun 3") or an intraday time ("09:30"). Both split
// into a (major, minor) pair that drives two vertical roll stacks:
//   date → major = month, minor = day
//   time → major = hour,  minor = minute

export type TickerMode = "date" | "time";

export interface Segment {
  value: string;
  startIndex: number;
  key: string;
}

/** Time labels carry a colon (`09:30`); date labels are space-separated (`Jun 3`). */
export function isTimeLabel(label: string): boolean {
  return label.includes(":");
}

export function tickerMode(labels: string[]): TickerMode {
  return labels.some(isTimeLabel) ? "time" : "date";
}

/** Split a label into its [major, minor] parts. */
export function splitLabel(label: string): [string, string] {
  if (isTimeLabel(label)) {
    const [hour = "", minute = ""] = label.split(":");
    return [hour, minute];
  }
  const [month = "", day = ""] = label.split(" ");
  return [month, day];
}

// Collapse consecutive equal values into runs. One node per distinct run means
// positioning by run-index only rolls when the value actually changes — so a
// value that repeats across bars (e.g. the day "3" across intraday bars, or an
// hour across :00/:30 bars) stays put instead of flipping in place.
export function buildSegments(values: string[]): Segment[] {
  const segments: Segment[] = [];
  values.forEach((value, index) => {
    const prev = segments.at(-1);
    if (!prev || prev.value !== value) {
      segments.push({ value, startIndex: index, key: `${value}-${index}` });
    }
  });
  return segments;
}

/** Index of the run containing `currentIndex` (the last run that started at or before it). */
export function segmentIndexFor(segments: Segment[], currentIndex: number): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg && seg.startIndex <= currentIndex) {
      return i;
    }
  }
  return 0;
}
