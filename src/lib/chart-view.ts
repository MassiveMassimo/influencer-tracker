import type { LiveBar } from "./chart-fetch.ts";
import type { OhlcBar } from "./types.ts";
import { type Timeframe, windowSeries } from "./window-series.ts";

export interface ChartView {
  timeframe: Timeframe;
  ohlc: LiveBar[];
  spy: LiveBar[];
  usingFallback: boolean;
}

// Builds the committed chart view. Live data passes through as-is (already
// windowed at fetch time via chartWindow). The fallback path windows the baked
// daily series to the selected timeframe — otherwise every tab renders the full
// history (and the headline change is computed over it). Windowing to the last
// baked bar (not `now`) keeps the most recent slice even when the cache is stale.
export function buildChartView(opts: {
  timeframe: Timeframe;
  live: { ohlc: LiveBar[]; spy: LiveBar[] } | null;
  bakedOhlc: OhlcBar[];
  bakedSpy: OhlcBar[];
}): ChartView {
  const { timeframe, live, bakedOhlc, bakedSpy } = opts;
  if (live) {
    return { timeframe, ohlc: live.ohlc, spy: live.spy, usingFallback: false };
  }
  return {
    timeframe,
    ohlc: windowSeries(bakedOhlc, timeframe),
    spy: windowSeries(bakedSpy, timeframe),
    usingFallback: true,
  };
}
