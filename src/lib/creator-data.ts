import { gradeFor, type Grade } from "./grade";
import { traitsFor, type Trait } from "./traits";
import type { Call, Dataset } from "./types";

export const CREATOR_CALLS_PAGE_SIZE = 25;

export interface CreatorConvictionRow {
  key: string;
  label: string;
  sublabel: string;
  value: number;
}

export interface CreatorCallsPage {
  calls: Call[];
  currentPage: number;
  pageCount: number;
  totalCalls: number;
  posts: Record<string, { ticker: string; company: string }[]>;
}

export interface CreatorOverview {
  dataset: Omit<Dataset, "calls">;
  initialPage: CreatorCallsPage;
  grade: Grade | null;
  traits: Trait[];
  convictionRows: CreatorConvictionRow[];
  scoredPickCount: number;
}

const CONVICTION_BUCKETS = [
  { key: "low", label: "Low", range: "<0.7", test: (value: number) => value < 0.7 },
  {
    key: "med",
    label: "Medium",
    range: "0.7‑0.9",
    test: (value: number) => value >= 0.7 && value < 0.9,
  },
  { key: "high", label: "High", range: "≥0.9", test: (value: number) => value >= 0.9 },
] as const;

function convictionRows(calls: Call[]): CreatorConvictionRow[] {
  const scored: { conviction: number; excess: number }[] = [];
  for (const call of calls) {
    const excess = call.returns.toDate.excess;
    if (call.isFirstCall && excess != null) {
      scored.push({ conviction: call.conviction, excess });
    }
  }

  return CONVICTION_BUCKETS.flatMap((bucket) => {
    const values = scored.filter((call) => bucket.test(call.conviction));
    if (values.length === 0) return [];
    return [
      {
        key: bucket.key,
        label: bucket.label,
        sublabel: `${values.length} ${values.length === 1 ? "call" : "calls"} · ${bucket.range}`,
        value: values.reduce((sum, call) => sum + call.excess, 0) / values.length,
      },
    ];
  });
}

function postsForPage(
  allCalls: Call[],
  visibleCalls: Call[],
): Record<string, { ticker: string; company: string }[]> {
  const shortcodes = new Set(visibleCalls.map((call) => call.shortcode));
  const posts: CreatorCallsPage["posts"] = {};
  for (const call of allCalls) {
    if (!shortcodes.has(call.shortcode)) continue;
    (posts[call.shortcode] ??= []).push({
      ticker: call.ticker,
      company: call.company,
    });
  }
  return posts;
}

export function buildCreatorCallsPage(ds: Dataset, requestedPage: number): CreatorCallsPage {
  const sorted = [...ds.calls].sort((a, b) => b.postDate.localeCompare(a.postDate));
  const pageCount = Math.max(1, Math.ceil(sorted.length / CREATOR_CALLS_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, Math.trunc(requestedPage)), pageCount);
  const start = (currentPage - 1) * CREATOR_CALLS_PAGE_SIZE;
  const calls = sorted.slice(start, start + CREATOR_CALLS_PAGE_SIZE);

  return {
    calls,
    currentPage,
    pageCount,
    totalCalls: sorted.length,
    posts: postsForPage(sorted, calls),
  };
}

export function buildCreatorOverview(ds: Dataset): CreatorOverview {
  const firstPage = buildCreatorCallsPage(ds, 1);
  const { calls: _calls, ...dataset } = ds;
  return {
    dataset,
    initialPage: firstPage,
    grade: gradeFor(ds.scorecard, ds.calls),
    traits: traitsFor(ds.calls),
    convictionRows: convictionRows(ds.calls),
    scoredPickCount: ds.calls.filter(
      (call) => call.isFirstCall && call.returns.toDate.excess != null,
    ).length,
  };
}
