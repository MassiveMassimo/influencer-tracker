import { test, expect } from "bun:test";
import { topStocksByLastCall } from "./rail-stocks";
import type { CallIndexEntry } from "./call-index";

function e(over: Partial<CallIndexEntry> & { shortcode: string }): CallIndexEntry {
  return {
    handle: "alice",
    ticker: "NVDA",
    company: "Nvidia",
    postDate: "2026-05-01",
    isFirstCall: true,
    conviction: 0.5,
    ex3m: 0,
    exToDate: 0,
    stockToDate: 0,
    ...over,
  };
}

test("aggregates by ticker, lastCall = max postDate, sorted desc", () => {
  const rows: CallIndexEntry[] = [
    e({ shortcode: "1", ticker: "NVDA", postDate: "2026-05-01" }),
    e({ shortcode: "2", ticker: "NVDA", postDate: "2026-06-10", company: "Nvidia Corp" }),
    e({ shortcode: "3", ticker: "AMD", postDate: "2026-05-20", company: "AMD" }),
  ];
  const out = topStocksByLastCall(rows);
  expect(out.map((s) => s.symbol)).toEqual(["NVDA", "AMD"]);
  expect(out[0].lastCall).toBe("2026-06-10");
  expect(out[0].company).toBe("Nvidia Corp"); // from the most-recent entry
});

test("uppercases ticker and caps at max", () => {
  const rows: CallIndexEntry[] = [
    e({ shortcode: "a", ticker: "aapl", postDate: "2026-01-01" }),
    e({ shortcode: "b", ticker: "msft", postDate: "2026-02-01" }),
    e({ shortcode: "c", ticker: "googl", postDate: "2026-03-01" }),
  ];
  const out = topStocksByLastCall(rows, 2);
  expect(out.map((s) => s.symbol)).toEqual(["GOOGL", "MSFT"]);
});
