import type { CallIndexEntry } from "./call-index";

export const EXPLORE_INITIAL_CALLS = 100;
export const EXPLORE_VISIBLE_STEP = 50;

export function buildExploreInitialData(calls: CallIndexEntry[]): {
  calls: CallIndexEntry[];
  totalCalls: number;
} {
  return {
    calls: calls.slice(0, EXPLORE_INITIAL_CALLS),
    totalCalls: calls.length,
  };
}
