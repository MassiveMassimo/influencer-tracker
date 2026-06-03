import { test, expect } from "bun:test";
import { assembleDataset } from "./score";
import type { ReelCall, OhlcBar } from "../src/lib/types";

test("assembleDataset scores calls and validates against schema", () => {
  const reelCalls: ReelCall[] = [{
    shortcode: "DZDmQutB0Ep", postDate: "2026-06-01", ticker: "NBIS",
    company: "Nebius Group N.V.", direction: "bullish", isExplicitBuy: true,
    conviction: 0.9, quote: "buy right here", onScreenPrice: 273.01, summary: "Bullish on Nebius.",
  }];
  const nbis: OhlcBar[] = [
    { date: "2026-06-01", o: 100, h: 100, l: 100, c: 100 },
    { date: "2026-06-08", o: 110, h: 110, l: 110, c: 110 },
  ];
  const spy: OhlcBar[] = [
    { date: "2026-06-01", o: 50, h: 50, l: 50, c: 50 },
    { date: "2026-06-08", o: 50, h: 50, l: 50, c: 50 },
  ];
  const ds = assembleDataset({ handle: "kevvonz", name: "Kevin Hu" },
    reelCalls, { NBIS: nbis, SPY: spy }, "2026-06-09");
  expect(ds.calls[0].isFirstCall).toBe(true);
  expect(ds.calls[0].returns["1w"].excess).toBeCloseTo(0.10, 6);
  expect(ds.scorecard.totalCalls).toBe(1);
  expect(ds.calls[0].spark).toEqual([100, 110]);
  expect((ds as unknown as { tickers?: unknown }).tickers).toBeUndefined();
});
