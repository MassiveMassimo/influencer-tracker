import { describe, it, expect } from "bun:test";
import { classify, toReelCall, buildReview, type Classification } from "./calls";

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

describe("toReelCall", () => {
  it("uppercases ticker and maps fields", () => {
    const rc = toReelCall(base, "tweet123", "2026-01-15");
    expect(rc).toMatchObject({
      shortcode: "tweet123", postDate: "2026-01-15", ticker: "NBIS",
      company: "Nebius", direction: "bullish", isExplicitBuy: true,
      conviction: 0.8, quote: "load up on NBIS", onScreenPrice: 65.1,
    });
  });
  it("returns null when no ticker", () => {
    expect(toReelCall({ ...base, ticker: null }, "t", "2026-01-15")).toBeNull();
  });
  it("applies defaults for missing optional fields", () => {
    const rc = toReelCall({ ticker: "AAPL" } as Classification, "t", "2026-01-15");
    expect(rc).toMatchObject({ company: "", direction: "neutral", isExplicitBuy: false, conviction: 0, quote: "", onScreenPrice: null });
  });
});

describe("classify", () => {
  const payload = {
    ticker: "NBIS", company: "Nebius", direction: "bullish",
    isExplicitBuy: true, conviction: 0.8, quote: "load up", onScreenPrice: 65.1,
    summary: "Bullish on NBIS.",
  };

  it("returns the parsed classification on a valid reply", async () => {
    const c = await classify("model", "body", reply(payload));
    expect(c.ticker).toBe("NBIS");
  });

  it("clamps an out-of-range conviction instead of throwing", async () => {
    const c = await classify("model", "body", reply({ ...payload, conviction: 2 }));
    expect(c.conviction).toBe(0);
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
      toReelCall(base, "t1", "2026-01-15")!,
      toReelCall({ ...base, ticker: "AAPL", direction: "neutral", isExplicitBuy: false }, "t2", "2026-02-01")!,
    ]);
    expect(md).toContain("Explicit bullish calls: 1");
    expect(md).toContain("NBIS");
    expect(md).toContain("| date | ticker |");
  });
});
