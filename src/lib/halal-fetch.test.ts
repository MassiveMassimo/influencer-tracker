import { describe, expect, it } from "bun:test";
import { assembleHalal, cacheGet, cacheSet } from "./halal-fetch.ts";
import { UNKNOWN_INFO, type HalalInfo } from "./halal/types.ts";
import { halalQuery } from "./halal-query.ts";

const AAPL: HalalInfo = {
  status: "halal",
  halalPct: 95,
  notHalalPct: 5,
  doubtfulPct: 0,
  exchange: "NASDAQ",
  ticker: "AAPL",
  musaffaUrl: "https://musaffa.com/stock/AAPL/",
  sector: "Technology",
  debtRatio: 12,
  securitiesRatio: 8,
};

describe("assembleHalal", () => {
  it("maps symbols to records by musaffaKey, unmatched -> unknown", () => {
    const out = assembleHalal(["AAPL", "BTC-USD"], { AAPL });
    expect(out.AAPL.status).toBe("halal");
    expect(out["BTC-USD"]).toEqual(UNKNOWN_INFO);
  });
  it("resolves class shares via the dot key", () => {
    const out = assembleHalal(["BRK-B"], { "BRK.B": { ...AAPL, ticker: "BRK.B" } });
    expect(out["BRK-B"].ticker).toBe("BRK.B");
  });
});

describe("cache", () => {
  it("returns null past TTL", () => {
    cacheSet("AAPL", AAPL, 0);
    expect(cacheGet("AAPL", 1000)).not.toBeNull();
    expect(cacheGet("AAPL", 6 * 60 * 1000 + 1)).toBeNull();
  });
});

describe("halalQuery", () => {
  it("keys by sorted symbols so order doesn't fragment the cache", () => {
    const key = halalQuery(["NVDA", "AAPL"]).queryKey;
    expect(key[0]).toBe("halal");
    expect(key[1]).toEqual(["AAPL", "NVDA"]);
  });
});
