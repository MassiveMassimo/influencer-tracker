// Headline readout for the ticker chart: the big price + colored delta above the
// candlestick. When the cursor is scrubbing the chart, `hoveredClose` is the
// hovered candle's close and the readout tracks it (Robinhood-style); otherwise
// it falls back to the window's last close. Delta/change are always measured from
// the window's first close, so the headline reads like a normal stock chart.
export interface HeadlineReadout {
  close: number | null;
  delta: number | null;
  change: number | null;
}

export function headlineReadout(
  hoveredClose: number | null,
  firstClose: number | null,
  lastClose: number | null,
): HeadlineReadout {
  const close = hoveredClose ?? lastClose;
  const delta = close != null && firstClose != null ? close - firstClose : null;
  // `firstClose` truthy guards against divide-by-zero (and null).
  const change = close != null && firstClose ? (close - firstClose) / firstClose : null;
  return { close, delta, change };
}
