import { describe, it, expect } from "bun:test";
import { tweetDate, tweetToReelCall, type ExtractDeps } from "./extract-x";
import type { Classification } from "../calls";

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
