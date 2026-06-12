import { describe, it, expect } from "bun:test";
import { cacheCovers } from "./prices";

describe("cacheCovers", () => {
  const bars = [{ date: "2025-01-01", o:1,h:1,l:1,c:1 }, { date: "2025-02-01", o:1,h:1,l:1,c:1 }];
  it("true when earliest bar is at/before `from`", () => {
    expect(cacheCovers(bars, "2025-03-01")).toBe(true);
    expect(cacheCovers(bars, "2025-01-01")).toBe(true);
  });
  it("false when the cache starts after `from` (misses older history)", () => {
    expect(cacheCovers(bars, "2024-06-01")).toBe(false);
  });
  it("false for a 1-bar or empty or non-array cache", () => {
    expect(cacheCovers([bars[0]], "2024-01-01")).toBe(false);
    expect(cacheCovers([], "2024-01-01")).toBe(false);
    expect(cacheCovers(null, "2024-01-01")).toBe(false);
  });
});
