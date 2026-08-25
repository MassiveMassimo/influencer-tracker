import { describe, expect, test } from "bun:test";
import type { Call, Dataset } from "./types";
import {
  CREATOR_CALLS_PAGE_SIZE,
  buildCreatorCallsPage,
  buildCreatorCallsPages,
  buildCreatorOverview,
} from "./creator-data";

const emptyReturn = { stock: null, spy: null, excess: null };

function call(
  ticker: string,
  postDate: string,
  shortcode: string,
  conviction = 0.5,
  excess: number | null = null,
): Call {
  return {
    shortcode,
    postDate,
    ticker,
    company: `${ticker} Inc.`,
    isFirstCall: true,
    conviction,
    quote: `${ticker} quote`,
    returns: {
      "1w": emptyReturn,
      "1m": emptyReturn,
      "3m": emptyReturn,
      toDate:
        excess == null
          ? emptyReturn
          : {
              stock: excess,
              spy: 0,
              excess,
            },
    },
  };
}

function dataset(calls: Call[]): Dataset {
  return {
    creator: { handle: "creator", name: "Creator" },
    generatedAt: "2026-08-25T00:00:00Z",
    spyAnchor: "2026-08-25",
    calls,
    scorecard: {
      totalCalls: calls.length,
      uniqueTickers: calls.length,
      hitRate: { "1m": 0, "3m": 0 },
      hitRateN: { "1m": 0, "3m": 0 },
      avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
      callsPerWeek: 0,
      best: [],
      worst: [],
      cumExcess: [],
    },
    caveats: [],
  };
}

describe("buildCreatorCallsPage", () => {
  test("sorts newest first, returns one bounded page, and does not mutate calls", () => {
    const calls = Array.from({ length: CREATOR_CALLS_PAGE_SIZE + 2 }, (_, index) =>
      call(`T${index}`, `2026-07-${String(index + 1).padStart(2, "0")}`, `post-${index}`),
    );
    const original = [...calls];

    const page = buildCreatorCallsPage(dataset(calls), 1);

    expect(page.calls).toHaveLength(CREATOR_CALLS_PAGE_SIZE);
    expect(page.calls[0]?.ticker).toBe("T26");
    expect(page.calls.at(-1)?.ticker).toBe("T2");
    expect(page.totalCalls).toBe(27);
    expect(page.currentPage).toBe(1);
    expect(page.pageCount).toBe(2);
    expect(calls).toEqual(original);
  });

  test("clamps the requested page", () => {
    const calls = Array.from({ length: CREATOR_CALLS_PAGE_SIZE + 2 }, (_, index) =>
      call(`T${index}`, `2026-07-${String(index + 1).padStart(2, "0")}`, `post-${index}`),
    );

    const page = buildCreatorCallsPage(dataset(calls), 99);

    expect(page.currentPage).toBe(2);
    expect(page.calls.map((item) => item.ticker)).toEqual(["T1", "T0"]);
  });

  test("includes all same-post calls for proof siblings", () => {
    const calls = [
      call("AAPL", "2026-08-03", "shared"),
      call("MSFT", "2026-08-03", "shared"),
      call("NVDA", "2026-08-02", "other"),
    ];

    const page = buildCreatorCallsPage(dataset(calls), 99);

    expect(page.posts.shared).toEqual([
      { ticker: "AAPL", company: "AAPL Inc." },
      { ticker: "MSFT", company: "MSFT Inc." },
    ]);
  });

  test("builds every bounded page from one creator dataset", () => {
    const calls = Array.from({ length: CREATOR_CALLS_PAGE_SIZE * 2 + 1 }, (_, index) =>
      call(`T${index}`, `2026-07-${String(index + 1).padStart(2, "0")}`, `post-${index}`),
    );

    const pages = buildCreatorCallsPages(dataset(calls));

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.calls.length)).toEqual([25, 25, 1]);
    expect(pages.map((page) => page.currentPage)).toEqual([1, 2, 3]);
    expect(pages.every((page) => page.totalCalls === calls.length)).toBe(true);
  });
});

describe("buildCreatorOverview", () => {
  test("keeps only the first page while preserving analytics from the complete dataset", () => {
    const calls = [
      call("LOW", "2026-08-01", "low", 0.6, -0.1),
      call("MED", "2026-08-02", "med", 0.8, 0.2),
      call("HIGH", "2026-08-03", "high", 0.95, 0.3),
      ...Array.from({ length: CREATOR_CALLS_PAGE_SIZE }, (_, index) =>
        call(`N${index}`, `2026-07-${String(index + 1).padStart(2, "0")}`, `new-${index}`),
      ),
    ];

    const overview = buildCreatorOverview(dataset(calls));

    expect("calls" in overview.dataset).toBe(false);
    expect(overview.initialPage.calls).toHaveLength(CREATOR_CALLS_PAGE_SIZE);
    expect(overview.initialPage.totalCalls).toBe(calls.length);
    expect(overview.scoredPickCount).toBe(3);
    expect(overview.convictionRows.map((row) => [row.key, row.value])).toEqual([
      ["low", -0.1],
      ["med", 0.2],
      ["high", 0.3],
    ]);
  });
});
