export interface Spark1D {
  changePct: number | null;
  closes: number[];
}

// Evenly sample a series down to `max` points, always keeping first + last.
export function sampleCloses(closes: number[], max = 24): number[] {
  if (closes.length <= max) return closes;
  if (max <= 1) return closes.slice(0, 1);
  const step = (closes.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => closes[Math.round(i * step)]);
}

// Defensive parse of Yahoo's v7 /finance/spark response. Tolerant of shape drift:
// anything unexpected for a symbol drops that symbol rather than throwing.
export function parseSparkResponse(json: unknown, maxPoints = 24): Record<string, Spark1D> {
  const out: Record<string, Spark1D> = {};
  const results = (json as any)?.spark?.result;
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    const symbol = typeof r?.symbol === "string" ? r.symbol.toUpperCase() : null;
    const resp = r?.response?.[0];
    const raw = resp?.indicators?.quote?.[0]?.close;
    if (!symbol || !Array.isArray(raw)) continue;
    const closes = raw.filter(
      (v: unknown): v is number => typeof v === "number" && Number.isFinite(v),
    );
    if (closes.length < 2) continue;
    const prev = resp?.meta?.chartPreviousClose ?? resp?.meta?.previousClose ?? closes[0];
    const last = closes[closes.length - 1];
    const changePct = typeof prev === "number" && prev !== 0 ? (last - prev) / prev : null;
    out[symbol] = { changePct, closes: sampleCloses(closes, maxPoints) };
  }
  return out;
}
