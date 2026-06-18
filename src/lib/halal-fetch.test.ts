import { describe, expect, it } from "bun:test";
import { assembleHalal, cacheGet, cacheSet } from "./halal-fetch.ts";
import { UNKNOWN_INFO, type HalalInfo } from "./halal/types.ts";

const AAPL: HalalInfo = {
  status: "halal",
  halalPct: 95,
  notHalalPct: 5,
  doubtfulPct: 0,
  exchange: "NASDAQ",
  ticker: "AAPL",
  musaffaUrl: "https://musaffa.com/stock/AAPL/NASDAQ",
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
