import { test, expect } from "bun:test";
import { applyCallFilter, summarizeTicker, type CallFilter } from "./call-filter";
import type { CallIndexEntry } from "./call-index";

const NAMES: Record<string, string> = { alice: "Alice Smith", bob: "Bob Jones" };
function e(over: Partial<CallIndexEntry> & { shortcode: string }): CallIndexEntry {
  return {
    handle: "alice", ticker: "NVDA", company: "Nvidia", postDate: "2026-05-01",
    isFirstCall: true, conviction: 0.5, ex3m: 0.05, exToDate: 0.1, stockToDate: 0.2,
    summary: "ai chips", ...over,
  };
}
const ROWS: CallIndexEntry[] = [
  e({ shortcode: "1", handle: "alice", ticker: "NVDA", postDate: "2026-05-03", ex3m: 0.2, exToDate: 0.3 }),
  e({ shortcode: "2", handle: "bob", ticker: "AMD", company: "AMD", summary: "cpus", postDate: "2026-05-01", ex3m: -0.1, exToDate: -0.05, isFirstCall: false }),
  e({ shortcode: "3", handle: "alice", ticker: "AMD", company: "AMD", postDate: "2026-05-02", ex3m: 0.0, exToDate: 0.0 }),
];
const BASE: CallFilter = { search: "", handles: [], firstOnly: false, beatSpyOnly: false, horizon: "ex3m", sort: { key: "postDate", dir: -1 } };

test("default: all rows, sorted by postDate desc", () => {
  expect(applyCallFilter(ROWS, BASE, NAMES).map((r) => r.shortcode)).toEqual(["1", "3", "2"]);
});
test("creator filter narrows to selected handles", () => {
  expect(applyCallFilter(ROWS, { ...BASE, handles: ["bob"] }, NAMES).map((r) => r.shortcode)).toEqual(["2"]);
});
test("firstOnly drops non-first calls", () => {
  expect(applyCallFilter(ROWS, { ...BASE, firstOnly: true }, NAMES).map((r) => r.shortcode)).toEqual(["1", "3"]);
});
test("beatSpyOnly keeps rows with positive excess at the chosen horizon", () => {
  expect(applyCallFilter(ROWS, { ...BASE, beatSpyOnly: true, horizon: "ex3m" }, NAMES).map((r) => r.shortcode)).toEqual(["1"]);
});
test("search matches ticker, company, summary, and creator name (case-insensitive)", () => {
  expect(applyCallFilter(ROWS, { ...BASE, search: "amd" }, NAMES).map((r) => r.shortcode).sort()).toEqual(["2", "3"]);
  expect(applyCallFilter(ROWS, { ...BASE, search: "bob jones" }, NAMES).map((r) => r.shortcode)).toEqual(["2"]);
  expect(applyCallFilter(ROWS, { ...BASE, search: "cpus" }, NAMES).map((r) => r.shortcode)).toEqual(["2"]);
});
test("sort by ex3m desc puts best first; nulls sort last", () => {
  const rows = [...ROWS, e({ shortcode: "4", ex3m: null })];
  expect(applyCallFilter(rows, { ...BASE, sort: { key: "ex3m", dir: -1 } }, NAMES).map((r) => r.shortcode)).toEqual(["1", "3", "2", "4"]);
});
test("summarizeTicker aggregates one ticker across creators", () => {
  const s = summarizeTicker(ROWS, "AMD");
  expect(s.symbol).toBe("AMD");
  expect(s.company).toBe("AMD");
  expect(s.callCount).toBe(2);
  expect(s.creatorCount).toBe(2);
  expect(s.byCreator.map((b) => b.handle).sort()).toEqual(["alice", "bob"]);
});
