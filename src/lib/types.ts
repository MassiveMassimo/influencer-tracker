export type Horizon = "1w" | "1m" | "3m" | "toDate";
export type Direction = "bullish" | "bearish" | "neutral";

export interface OhlcBar { date: string; o: number; h: number; l: number; c: number }
export interface ReturnTriple { stock: number | null; spy: number | null; excess: number | null }

export interface Call {
  shortcode: string;
  postDate: string;            // ISO date, the signal date
  ticker: string;
  company: string;
  isFirstCall: boolean;
  conviction: number;          // 0..1
  quote: string;
  summary?: string;            // one-sentence context on what the post is about
  onScreenPrice?: number | null;
  returns: Record<Horizon, ReturnTriple>;
}

export interface FunnelStage { label: string; value: number }

export interface Scorecard {
  totalCalls: number;
  uniqueTickers: number;
  hitRate: { "1m": number; "3m": number };
  hitRateN: { "1m": number; "3m": number };
  avgExcess: Record<Horizon, number>;
  callsPerWeek: number;
  best: Call[];
  worst: Call[];
  funnel?: FunnelStage[];
}

export interface Dataset {
  creator: { handle: string; name: string };
  generatedAt: string;
  spyAnchor: string;
  calls: Call[];
  tickers: Record<string, { ohlc: OhlcBar[] }>;
  scorecard: Scorecard;
  caveats: string[];
}

// Intermediate type emitted by the extract stage (pre-scoring).
export interface ReelCall {
  shortcode: string;
  postDate: string;
  ticker: string;
  company: string;
  direction: Direction;
  isExplicitBuy: boolean;
  conviction: number;
  quote: string;
  onScreenPrice: number | null;
  summary: string;
}
