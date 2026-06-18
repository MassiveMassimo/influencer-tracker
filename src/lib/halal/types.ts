// Pure, isomorphic halal-compliance helpers + types. No network, client-safe.

export type HalalStatus = "halal" | "doubtful" | "not_halal" | "unknown";

export interface HalalInfo {
  status: HalalStatus;
  halalPct: number;
  notHalalPct: number;
  doubtfulPct: number;
  exchange: string;
  ticker: string;
  musaffaUrl: string;
  sector: string;
  // AAOIFI financial screens (percent of market cap): interest-bearing debt and
  // interest-bearing securities/assets. Compliant thresholds are ~30% / ~30%.
  debtRatio: number;
  securitiesRatio: number;
}

export const UNKNOWN_INFO: HalalInfo = {
  status: "unknown",
  halalPct: 0,
  notHalalPct: 0,
  doubtfulPct: 0,
  exchange: "",
  ticker: "",
  musaffaUrl: "",
  sector: "",
  debtRatio: 0,
  securitiesRatio: 0,
};

const RATING_MAP: Record<string, HalalStatus> = {
  COMPLIANT: "halal",
  HALAL: "halal",
  NON_COMPLIANT: "not_halal",
  NOT_COMPLIANT: "not_halal",
  NOT_HALAL: "not_halal",
  QUESTIONABLE: "doubtful",
  DOUBTFUL: "doubtful",
};

export function parseRating(raw: string | undefined): HalalStatus {
  if (!raw) return "unknown";
  return RATING_MAP[raw.trim().toUpperCase()] ?? "unknown";
}

// Derive the Musaffa Typesense `id` key from an app/Yahoo-canonical symbol.
// Musaffa keys by US ticker and uses a dot for class shares (BRK.B). Do NOT run
// resolveSymbol here — it rewrites toward Yahoo notation and would break matches.
export function musaffaKey(symbol: string): string {
  const s = symbol.trim().replace(/^\$/, "").toUpperCase();
  // Class shares: Yahoo "BRK-B" -> Musaffa "BRK.B". Single trailing letter only,
  // so "BTC-USD" (crypto) is left alone and falls through to unknown.
  return s.replace(/^([A-Z]+)-([A-Z])$/, "$1.$2");
}

// Musaffa stock page is keyed by ticker only — no exchange segment. Verified against
// musaffa.com's own links (e.g. /stock/NVDA/, /stock/BRK.B/, /stock/RELIANCE.NS/).
// Appending the exchange (/stock/NOW/NYSE) 404s.
export function musaffaUrl(ticker: string): string {
  return `https://musaffa.com/stock/${ticker}/`;
}

// Per-status display label + semantic fill (emerald/amber/red), shared by the
// popup gauge and the inline panel/donut. Hex equals the badge's Tailwind colors.
export const STATUS_META: Record<HalalStatus, { label: string; fill: string }> = {
  halal: { label: "Shariah-compliant", fill: "#10b981" },
  doubtful: { label: "Compliance questionable", fill: "#f59e0b" },
  not_halal: { label: "Not compliant", fill: "#ef4444" },
  unknown: { label: "Compliance unknown", fill: "#94a3b8" },
};

export function badgeKindFor(status: HalalStatus): "halal" | "doubtful" | null {
  if (status === "halal") return "halal";
  if (status === "doubtful") return "doubtful";
  return null;
}

// Gauge centerValue is formatted by Intl.NumberFormat; style:"percent" multiplies
// by 100, so feed it the 0-1 fraction, not the raw 0-100 percent.
export function purityFraction(halalPct: number): number {
  return halalPct / 100;
}
