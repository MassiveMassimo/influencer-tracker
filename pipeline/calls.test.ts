import { describe, it, expect } from "bun:test";
import { classify, toReelCalls, buildReview, type Classification } from "./calls";

// Fake OpenAI-compatible POST fn: replies with the given JSON body, no network.
const fakeClient = (bodyJson: unknown) =>
  (async () => new Response(JSON.stringify(bodyJson), { status: 200 })) as unknown as
    (path: string, init?: RequestInit) => Promise<Response>;

const reply = (payload: unknown) => fakeClient({ choices: [{ message: { content: JSON.stringify(payload) } }] });

const base: Classification = {
  ticker: "nbis", company: "Nebius", direction: "bullish",
  isExplicitBuy: true, conviction: 0.8, quote: "load up on NBIS", onScreenPrice: 65.1,
  summary: "Bullish on NBIS.",
};

describe("toReelCalls", () => {
  it("uppercases ticker and maps fields", () => {
    const [rc] = toReelCalls([base], "tweet123", "2026-01-15");
    expect(rc).toMatchObject({
      shortcode: "tweet123", postDate: "2026-01-15", ticker: "NBIS",
      company: "Nebius", direction: "bullish", isExplicitBuy: true,
      conviction: 0.8, quote: "load up on NBIS", onScreenPrice: 65.1,
    });
  });
  it("emits one ReelCall per named ticker in a multi-stock post", () => {
    const rcs = toReelCalls(
      [base, { ...base, ticker: "AMD", company: "AMD" }, { ...base, ticker: "tsla", company: "Tesla" }],
      "post1", "2026-01-15",
    );
    expect(rcs.map((c) => c.ticker)).toEqual(["NBIS", "AMD", "TSLA"]);
    expect(rcs.every((c) => c.shortcode === "post1")).toBe(true);
  });
  it("collapses duplicate tickers within a post (first wins)", () => {
    const rcs = toReelCalls([base, { ...base, quote: "again" }], "post1", "2026-01-15");
    expect(rcs).toHaveLength(1);
    expect(rcs[0]!.quote).toBe("load up on NBIS");
  });
  it("drops entries with no ticker", () => {
    expect(toReelCalls([{ ...base, ticker: null }], "t", "2026-01-15")).toEqual([]);
  });
  it("strips a leading $ from the ticker ($TSLA -> TSLA)", () => {
    const [rc] = toReelCalls([{ ...base, ticker: "$tsla" }], "t", "2026-01-15");
    expect(rc!.ticker).toBe("TSLA");
  });
  it("collapses $TSLA and TSLA in one post to a single call", () => {
    const rcs = toReelCalls([{ ...base, ticker: "TSLA" }, { ...base, ticker: "$TSLA" }], "t", "2026-01-15");
    expect(rcs.map((c) => c.ticker)).toEqual(["TSLA"]);
  });
  it("returns [] for an empty classification array (no stock)", () => {
    expect(toReelCalls([], "t", "2026-01-15")).toEqual([]);
  });
  it("applies defaults for missing optional fields", () => {
    const [rc] = toReelCalls([{ ticker: "AAPL" } as Classification], "t", "2026-01-15");
    expect(rc).toMatchObject({ company: "", direction: "neutral", isExplicitBuy: false, conviction: 0, quote: "", onScreenPrice: null });
  });
});

describe("classify", () => {
  const item = {
    ticker: "NBIS", company: "Nebius", direction: "bullish",
    isExplicitBuy: true, conviction: 0.8, quote: "load up", onScreenPrice: 65.1,
    summary: "Bullish on NBIS.",
  };

  it("returns the parsed calls array on a valid reply", async () => {
    const cs = await classify("model", "body", reply({ calls: [item] }));
    expect(cs).toHaveLength(1);
    expect(cs[0]!.ticker).toBe("NBIS");
  });

  it("parses a multi-stock reply into several classifications", async () => {
    const cs = await classify("model", "body", reply({ calls: [item, { ...item, ticker: "AMD" }] }));
    expect(cs.map((c) => c.ticker)).toEqual(["NBIS", "AMD"]);
  });

  it("returns [] for an empty calls array", async () => {
    expect(await classify("model", "body", reply({ calls: [] }))).toEqual([]);
  });

  it("defensively accepts a bare single object (missing envelope)", async () => {
    const cs = await classify("model", "body", reply(item));
    expect(cs[0]!.ticker).toBe("NBIS");
  });

  it("clamps an out-of-range conviction instead of throwing", async () => {
    const cs = await classify("model", "body", reply({ calls: [{ ...item, conviction: 2 }] }));
    expect(cs[0]!.conviction).toBe(1);
  });

  it("throws when the reply has no choices", async () => {
    await expect(classify("model", "body", fakeClient({}))).rejects.toThrow();
  });

  it("throws when the reply content is not JSON", async () => {
    await expect(
      classify("model", "body", fakeClient({ choices: [{ message: { content: "not json" } }] })),
    ).rejects.toThrow();
  });
});

describe("buildReview", () => {
  it("counts explicit bullish calls and renders rows", () => {
    const md = buildReview([
      ...toReelCalls([base], "t1", "2026-01-15"),
      ...toReelCalls([{ ...base, ticker: "AAPL", direction: "neutral", isExplicitBuy: false }], "t2", "2026-02-01"),
    ]);
    expect(md).toContain("Explicit bullish calls: 1");
    expect(md).toContain("NBIS");
    expect(md).toContain("| date | ticker |");
  });
});
