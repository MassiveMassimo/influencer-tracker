import type { CallIndexEntry } from "./call-index";

export type HorizonKey = "ex3m" | "exToDate";
export type SortKey = "postDate" | "conviction" | "ex3m" | "exToDate";

export interface CallFilter {
  search: string;
  handles: string[]; // empty = all creators
  firstOnly: boolean;
  beatSpyOnly: boolean;
  horizon: HorizonKey; // which excess column "beatSpyOnly" uses
  sort: { key: SortKey; dir: 1 | -1 };
}

// Nulls always sort last regardless of direction (a missing metric is not "worst").
function cmpNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

export function applyCallFilter(
  rows: CallIndexEntry[],
  f: CallFilter,
  names: Record<string, string>,
): CallIndexEntry[] {
  const q = f.search.trim().toLowerCase();
  const handleSet = f.handles.length ? new Set(f.handles) : null;
  const filtered = rows.filter((r) => {
    if (handleSet && !handleSet.has(r.handle)) return false;
    if (f.firstOnly && !r.isFirstCall) return false;
    if (f.beatSpyOnly) {
      const ex = r[f.horizon];
      if (ex == null || ex <= 0) return false;
    }
    if (q) {
      const hay = `${r.ticker} ${r.company} ${r.summary ?? ""} ${names[r.handle] ?? ""} ${r.handle}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const { key, dir } = f.sort;
  return filtered.sort((a, b) => {
    if (key === "postDate") return a.postDate.localeCompare(b.postDate) * dir || a.shortcode.localeCompare(b.shortcode);
    if (key === "conviction") return (a.conviction - b.conviction) * dir || a.shortcode.localeCompare(b.shortcode);
    return cmpNullable(a[key], b[key], dir) || a.shortcode.localeCompare(b.shortcode);
  });
}

export interface TickerCreatorRow {
  handle: string;
  callCount: number;
  firstCallDate: string | null; // earliest first-call postDate for this ticker
  lastCallDate: string | null; // latest postDate for this ticker
  bestEx3m: number | null;
  ex3m: number | null; // first-call ex3m (the representative call)
  exToDate: number | null;
}
export interface TickerSummary {
  symbol: string;
  company: string;
  callCount: number;
  creatorCount: number;
  avgEx3m: number | null;
  avgExToDate: number | null;
  byCreator: TickerCreatorRow[];
}

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// Aggregate one ticker across all creators who called it. Drives /t/$symbol.
export function summarizeTicker(rows: CallIndexEntry[], symbol: string): TickerSummary {
  const sym = symbol.toUpperCase();
  const hits = rows.filter((r) => r.ticker.toUpperCase() === sym);
  const byHandle = new Map<string, CallIndexEntry[]>();
  for (const r of hits) {
    const arr = byHandle.get(r.handle) ?? [];
    arr.push(r);
    byHandle.set(r.handle, arr);
  }
  const byCreator: TickerCreatorRow[] = [...byHandle.entries()].map(([handle, cs]) => {
    const first = cs.find((c) => c.isFirstCall) ?? [...cs].sort((a, b) => a.postDate.localeCompare(b.postDate))[0];
    return {
      handle,
      callCount: cs.length,
      firstCallDate: first?.postDate ?? null,
      lastCallDate: cs.reduce<string | null>((m, c) => (m == null || c.postDate > m ? c.postDate : m), null),
      bestEx3m: cs.reduce<number | null>((m, c) => (c.ex3m != null && (m == null || c.ex3m > m) ? c.ex3m : m), null),
      ex3m: first?.ex3m ?? null,
      exToDate: first?.exToDate ?? null,
    };
  });
  byCreator.sort((a, b) => cmpNullable(a.ex3m, b.ex3m, -1) || a.handle.localeCompare(b.handle));
  return {
    symbol: sym,
    company: hits[0]?.company ?? sym,
    callCount: hits.length,
    creatorCount: byHandle.size,
    avgEx3m: avg(byCreator.map((b) => b.ex3m)),
    avgExToDate: avg(byCreator.map((b) => b.exToDate)),
    byCreator,
  };
}
