import { test, expect } from "bun:test";
import { formatTakenAt, mergePostDates, loadPostDates, savePostDates } from "./post-dates";
import { rmSync } from "node:fs";
import { DATA } from "./config";
import { join as pjoin } from "node:path";

test("formatTakenAt: UTC YYYY-MM-DD; null for falsy/invalid", () => {
  // 2026-03-11T00:00:00Z = 1773187200000 ms
  expect(formatTakenAt(1773187200000)).toBe("2026-03-11");
  // near a midnight-UTC boundary stays on the UTC day
  expect(formatTakenAt(Date.UTC(2026, 2, 11, 23, 59, 0))).toBe("2026-03-11");
  expect(formatTakenAt(0)).toBe(null);
  expect(formatTakenAt(-1)).toBe(null);
  expect(formatTakenAt(Number.NaN)).toBe(null);
});

test("mergePostDates: existing-wins, adds new, no mutation", () => {
  const existing = { a: "2026-01-01" };
  const incoming = { a: "2026-09-09", b: "2026-02-02" };
  const out = mergePostDates(existing, incoming);
  expect(out).toEqual({ a: "2026-01-01", b: "2026-02-02" });
  expect(existing).toEqual({ a: "2026-01-01" }); // unchanged
  expect(incoming).toEqual({ a: "2026-09-09", b: "2026-02-02" }); // unchanged
});

test("save then load round-trips; missing file -> {}", async () => {
  const handle = `__test_pd_${Date.now()}`;
  try {
    expect(await loadPostDates(handle)).toEqual({}); // missing -> {}
    await savePostDates(handle, { ABC123: "2026-03-11" });
    expect(await loadPostDates(handle)).toEqual({ ABC123: "2026-03-11" });
  } finally {
    rmSync(pjoin(DATA, handle), { recursive: true, force: true });
  }
});
