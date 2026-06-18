import { describe, expect, it, afterEach } from "bun:test";
import { fetchMusaffa, MusaffaOutage } from "./musaffa.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("fetchMusaffa", () => {
  it("parses hits into HalalInfo keyed by id", async () => {
    mockFetch(200, {
      hits: [
        {
          document: {
            id: "AAPL",
            musaffaHalalRating: "COMPLIANT",
            halal_revenue_percent: 95.92,
            nothalal_revenue_percent: 4.08,
            doubtful_revenue_percent: 0,
            exchange: "NASDAQ",
            ticker: "AAPL",
            musaffaSector: "Technology",
            interestbearing_debt_percent: 12.5,
            intrestbearing_asset_percent: 8.1,
          },
        },
      ],
    });
    const out = await fetchMusaffa(["AAPL"], "key");
    expect(out.AAPL.status).toBe("halal");
    expect(out.AAPL.halalPct).toBeCloseTo(95.92);
    expect(out.AAPL.musaffaUrl).toBe("https://musaffa.com/stock/AAPL/");
    expect(out.AAPL.sector).toBe("Technology");
    expect(out.AAPL.debtRatio).toBeCloseTo(12.5);
    expect(out.AAPL.securitiesRatio).toBeCloseTo(8.1);
  });

  it("throws MusaffaOutage on 5xx", async () => {
    mockFetch(503, { message: "down" });
    await expect(fetchMusaffa(["AAPL"], "key")).rejects.toBeInstanceOf(MusaffaOutage);
  });

  it("returns empty map for no keys without fetching", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    expect(await fetchMusaffa([], "key")).toEqual({});
  });
});
