import { expect, mock, test } from "bun:test";

mock.module("./data", () => ({
  fetchCallsIndex: async () => [],
}));

const { callsIndexQuery } = await import("./calls-index-query");

test("versions complete-index cache entries by exact content revision", () => {
  expect(Array.from(callsIndexQuery("2026-08-25T00:00:00Z").queryKey)).toEqual([
    "calls-index",
    "2026-08-25T00:00:00Z",
  ]);
  expect(Array.from(callsIndexQuery("2026-08-26T00:00:00Z").queryKey)).not.toEqual(
    Array.from(callsIndexQuery("2026-08-25T00:00:00Z").queryKey),
  );
});
