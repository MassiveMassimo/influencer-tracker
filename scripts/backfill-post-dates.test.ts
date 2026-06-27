import { test, expect } from "bun:test";
import { postDatesFromDataset } from "./backfill-post-dates";

test("postDatesFromDataset: dedup by shortcode, drop incomplete", () => {
  const calls = [
    { shortcode: "ABC", ticker: "NVDA", postDate: "2026-03-11" },
    { shortcode: "ABC", ticker: "AMD", postDate: "2026-03-11" }, // same reel, multi-ticker
    { shortcode: "DEF", ticker: "TSLA", postDate: "2026-04-01" },
    { shortcode: "GHI", ticker: "X", postDate: "" }, // no date -> dropped
    { ticker: "Y", postDate: "2026-05-05" }, // no shortcode -> dropped
  ] as any;
  expect(postDatesFromDataset(calls)).toEqual({ ABC: "2026-03-11", DEF: "2026-04-01" });
});
