// Canonical Yahoo-symbol resolution. The single seam that turns a raw,
// LLM-extracted ticker into the symbol used for every Yahoo request and every
// price-file key. Returns null for out-of-scope / unresolvable symbols, which
// the scoring gate treats as "drop this call".

// Explicit allow-list of crypto bases present in the data. Do NOT pattern-match
// (e.g. /^[A-Z]{3}$/) — that would capture hundreds of real equities. Bare BTC
// and ETH are also real equity tickers (Grayscale Mini Trust ETFs); mapping them
// to spot -USD is a deliberate product override — a creator saying "$BTC" means
// Bitcoin. Extend by hand as new crypto bases appear.
const CRYPTO_BASES = ["BTC", "ETH"];

// Equities the extractor emits in the wrong notation; Yahoo needs the suffix.
const OVERRIDES: Record<string, string> = {
  HEIA: "HEIA.AS", // Heineken, Euronext Amsterdam
};

// Out-of-scope CFD / index pseudo-symbols seen in the data.
const REJECT = new Set(["SPCFD"]);

export function resolveSymbol(raw: string): string | null {
  const s = raw.trim().replace(/^\$/, "").toUpperCase();
  if (!s) return null;

  // Continuous-futures notation, e.g. SI1!, ES1! — out of scope.
  if (s.endsWith("!")) return null;
  if (REJECT.has(s)) return null;

  const override = OVERRIDES[s];
  if (override !== undefined) return override;

  for (const base of CRYPTO_BASES) {
    if (s === base || s === `${base}USD` || s === `${base}USDT` || s === `${base}.X`) {
      return `${base}-USD`;
    }
  }

  return s;
}
