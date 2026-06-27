import { describe, it, expect } from "bun:test";
import { tweetDate, tweetToReelCalls, dedupeCalls, type ExtractDeps } from "./extract-x";
import type { Classification } from "../calls";
import type { ReelCall } from "../../src/lib/types";

const deps = (cs: Classification[]): ExtractDeps => ({
  text: "text-model",
  vision: "vision-model",
  classifyFn: async () => cs,
  readImageFn: async () => ({ ticker: null, price: null }),
});

describe("tweetDate", () => {
  it("formats ISO to YYYY-MM-DD", () => {
    expect(tweetDate("2026-01-15T10:30:00.000Z")).toBe("2026-01-15");
  });
});

describe("tweetToReelCalls", () => {
  it("maps a classified tweet to a ReelCall with tweet id + date", async () => {
    const rcs = await tweetToReelCalls(
      { id: "t1", createdAt: "2026-01-15T10:00:00.000Z", text: "buy NBIS", imageUrls: [] },
      "profinv",
      deps([
        {
          ticker: "nbis",
          company: "Nebius",
          direction: "bullish",
          isExplicitBuy: true,
          conviction: 0.7,
          quote: "buy NBIS",
          onScreenPrice: null,
          summary: "Bullish on NBIS.",
        },
      ]),
    );
    expect(rcs).toHaveLength(1);
    expect(rcs[0]).toMatchObject({
      shortcode: "t1",
      postDate: "2026-01-15",
      ticker: "NBIS",
      isExplicitBuy: true,
    });
  });
  it("maps a multi-stock tweet to one ReelCall per ticker, all sharing the tweet id", async () => {
    const rcs = await tweetToReelCalls(
      { id: "t3", createdAt: "2026-01-15T10:00:00.000Z", text: "buy NVDA and AMD", imageUrls: [] },
      "profinv",
      deps([
        {
          ticker: "NVDA",
          company: "Nvidia",
          direction: "bullish",
          isExplicitBuy: true,
          conviction: 0.9,
          quote: "buy NVDA",
          onScreenPrice: null,
          summary: "s",
        },
        {
          ticker: "AMD",
          company: "AMD",
          direction: "bullish",
          isExplicitBuy: true,
          conviction: 0.8,
          quote: "buy AMD",
          onScreenPrice: null,
          summary: "s",
        },
      ]),
    );
    expect(rcs.map((c) => c.ticker)).toEqual(["NVDA", "AMD"]);
    expect(rcs.every((c) => c.shortcode === "t3")).toBe(true);
  });
  it("returns [] when the model finds no ticker", async () => {
    const rcs = await tweetToReelCalls(
      { id: "t2", createdAt: "2026-01-15T10:00:00.000Z", text: "gm", imageUrls: [] },
      "profinv",
      deps([]),
    );
    expect(rcs).toEqual([]);
  });
});

describe("dedupeCalls", () => {
  const mk = (shortcode: string, ticker: string): ReelCall => ({
    shortcode,
    postDate: "2026-01-01",
    ticker,
    company: "",
    direction: "bullish",
    isExplicitBuy: true,
    conviction: 0.5,
    quote: "",
    onScreenPrice: null,
    summary: "",
  });
  it("keeps the first occurrence and drops later duplicates by (shortcode, ticker)", () => {
    const out = dedupeCalls([mk("t1", "AAA"), mk("t1", "AAA"), mk("t2", "CCC")]);
    expect(out.map((c) => `${c.shortcode}:${c.ticker}`)).toEqual(["t1:AAA", "t2:CCC"]);
  });
  it("keeps two different tickers on the same post (multi-stock)", () => {
    const out = dedupeCalls([mk("t1", "AAA"), mk("t1", "BBB")]);
    expect(out.map((c) => c.ticker)).toEqual(["AAA", "BBB"]);
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeCalls([])).toEqual([]);
  });
});
