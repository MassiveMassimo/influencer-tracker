import { expect, mock, test } from "bun:test";

const requestedVersions: Array<string | undefined> = [];
mock.module("./data", () => ({
  fetchCallsIndex: async (version?: string) => {
    requestedVersions.push(version);
    return [];
  },
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

test("binds the requested cache revision to the network fetch", async () => {
  const version = "sha256-0123456789abcdef0123456789abcdef";
  await callsIndexQuery(version).queryFn?.({} as never);
  expect(requestedVersions).toEqual([version]);
});
