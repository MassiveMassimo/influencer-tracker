// Horizontal position (0..100%) of a date within [start, end], clamped.
// Zero-width range collapses to the centre so a single-date row still renders.
export function timelineXPercent(dateMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 50;
  const pct = ((dateMs - startMs) / (endMs - startMs)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function ym(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

// Start / mid / end axis ticks.
export function timelineTicks(startMs: number, endMs: number): { label: string; pct: number }[] {
  const mid = startMs + (endMs - startMs) / 2;
  return [
    { label: ym(startMs), pct: 0 },
    { label: ym(mid), pct: 50 },
    { label: ym(endMs), pct: 100 },
  ];
}
