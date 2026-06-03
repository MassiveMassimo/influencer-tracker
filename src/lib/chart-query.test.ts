import { describe, it, expect } from "bun:test";
import { chartQuery } from "./chart-query.ts";

describe("chartQuery", () => {
  it("keys by symbol + timeframe and sets a 5-minute staleTime", () => {
    const opts = chartQuery("AAPL", "1M", "2025-06-03");
    expect([...opts.queryKey]).toEqual(["chart", "AAPL", "1M"]);
    expect(opts.staleTime).toBe(5 * 60 * 1000);
    expect(typeof opts.queryFn).toBe("function");
  });
});
