import { describe, it, expect } from "bun:test";
import { tweetDate, tweetToReelCall, dedupeByShortcode, type ExtractDeps } from "./extract-x";
import type { Classification } from "../calls";
import type { ReelCall } from "../../src/lib/types";

const deps = (c: Classification | null): ExtractDeps => ({
  text: "text-model", vision: "vision-model",
  classifyFn: async () => c,
  readImageFn: async () => ({ ticker: null, price: null }),
});

describe("tweetDate", () => {
  it("formats ISO to YYYY-MM-DD", () => {
    expect(tweetDate("2026-01-15T10:30:00.000Z")).toBe("2026-01-15");
  });
});

describe("tweetToReelCall", () => {
  it("maps a classified tweet to a ReelCall with tweet id + date", async () => {
    const rc = await tweetToReelCall(
      { id: "t1", createdAt: "2026-01-15T10:00:00.000Z", text: "buy NBIS", imageUrls: [] },
      "profinv",
      deps({ ticker: "nbis", company: "Nebius", direction: "bullish", isExplicitBuy: true, conviction: 0.7, quote: "buy NBIS", onScreenPrice: null, summary: "Bullish on NBIS." }),
    );
    expect(rc).toMatchObject({ shortcode: "t1", postDate: "2026-01-15", ticker: "NBIS", isExplicitBuy: true });
  });
  it("returns null when classifier finds no call", async () => {
    const rc = await tweetToReelCall(
      { id: "t2", createdAt: "2026-01-15T10:00:00.000Z", text: "gm", imageUrls: [] },
      "profinv", deps(null),
    );
    expect(rc).toBeNull();
  });
});

describe("dedupeByShortcode", () => {
  it("keeps the first occurrence and drops later duplicates by shortcode", () => {
    const mk = (shortcode: string, ticker: string): ReelCall => ({
      shortcode, postDate: "2026-01-01", ticker, company: "", direction: "bullish",
      isExplicitBuy: true, conviction: 0.5, quote: "", onScreenPrice: null, summary: "",
    });
    const out = dedupeByShortcode([mk("t1", "AAA"), mk("t1", "BBB"), mk("t2", "CCC")]);
    expect(out.map((c) => c.shortcode)).toEqual(["t1", "t2"]);
    expect(out[0]!.ticker).toBe("AAA");
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeByShortcode([])).toEqual([]);
  });
});
