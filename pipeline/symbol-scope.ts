// Scope filter for what counts as a scorable "call". A finfluencer pick is an
// individual security; index ETFs / mutual funds / indices / FX / derivatives are
// not stock-picking skill and shouldn't be scored. Equities AND crypto stay in
// scope (the product deliberately maps $BTC -> BTC-USD; see src/lib/symbol.ts).
//
// The signal is Yahoo's quoteType, resolved once per symbol and cached to disk so
// scoring stays reproducible and offline after the first lookup. The same quote()
// also yields the company name (display field) — captured alongside the type so
// `company` is derived deterministically from the canonical symbol, not the LLM's
// flaky optional `company` field (which it omits ~half the time).
import YahooFinance from "yahoo-finance2";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config";

const yahooFinance = new YahooFinance();

// Deny-list, fail-open: only a CONFIRMED excluded type drops a call. A genuinely
// unknown quoteType is kept, because a silent recall loss (dropping a real stock
// call) is worse than scoring a stray fund — the latter is visible and fixable.
// ECNQUOTE is included: Yahoo returns it when a symbol doesn't resolve to a clean
// primary listing (e.g. a foreign ETF like VFV queried without its .TO suffix). A
// real primary-listed equity never comes back ECNQUOTE, so it signals an ambiguous,
// non-scorable security — drop it (the OUT-OF-SCOPE log also surfaces the gap).
const OUT_OF_SCOPE = new Set([
  "ETF",
  "MUTUALFUND",
  "INDEX",
  "CURRENCY",
  "FUTURE",
  "OPTION",
  "ECNQUOTE",
]);

export interface SymbolMeta {
  type: string; // Yahoo quoteType ("" if unresolvable)
  name: string; // company / display name ("" if unresolvable)
}

const CACHE = join(ROOT, "data", "symbol-meta.json");

export function isOutOfScope(quoteType: string | undefined): boolean {
  return !!quoteType && OUT_OF_SCOPE.has(quoteType);
}

async function loadCache(): Promise<Record<string, SymbolMeta>> {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(await readFile(CACHE, "utf8"));
  } catch {
    return {};
  }
}

// Resolve quoteType + name for each symbol, caching to data/symbol-meta.json. One
// quote() call per uncached symbol; an unresolvable symbol caches "" for both
// (fail-open). displayName is the cleanest form ("NVIDIA", "Hims & Hers Health");
// longName/shortName are the verbose fallback for symbols Yahoo gives no display.
export async function symbolMeta(symbols: string[]): Promise<Record<string, SymbolMeta>> {
  const cache = await loadCache();
  let dirty = false;
  for (const s of symbols) {
    if (s in cache) continue;
    try {
      const q = (await yahooFinance.quote(s)) as {
        quoteType?: string;
        displayName?: string;
        longName?: string;
        shortName?: string;
      };
      cache[s] = {
        type: q?.quoteType ?? "",
        name: q?.displayName ?? q?.longName ?? q?.shortName ?? "",
      };
    } catch {
      cache[s] = { type: "", name: "" };
    }
    dirty = true;
  }
  if (dirty) await writeFile(CACHE, JSON.stringify(cache, null, 2) + "\n");
  return cache;
}
