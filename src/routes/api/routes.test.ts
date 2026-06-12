import { test, expect, mock, afterEach } from "bun:test";

// dataset-source.ts uses import.meta.glob (Vite-only) via the data.ts import chain; stub it.
// Under bun test import.meta.env.SSR is undefined, so the SSR/DB branch is skipped and each
// handler exercises the static-fallback path — now an HTTP fetch of the CDN asset (public/ is
// CDN-only on Vercel, not on the function filesystem). global.fetch is mocked per-path below.
mock.module("#/lib/dataset-source.ts", () => ({ loadIndex: () => [] }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (fn: () => unknown) => fn }),
}));

import { DatasetSchema, PriceFileSchema } from "#/lib/schema.ts";
import { CallIndexSchema } from "#/lib/call-index.ts";
import { CACHE_CONTROL } from "#/lib/api-serve.ts";

type Handler = (ctx: { params: Record<string, string> }) => Promise<Response>;
// The generated Route type carries the full router generics; reach the GET handler structurally.
function getHandler(route: unknown): Handler {
  return (route as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers
    .GET;
}

// Minimal fixtures valid against the zod schemas — inlined so the test never reads gitignored
// public/ assets (CI-safe regardless of whether prebuild ran).
const DATASET_FIXTURE = {
  creator: { handle: "kevvonz", name: "Kevin Hu" },
  generatedAt: "2026-06-03",
  spyAnchor: "2026-06-03",
  calls: [],
  scorecard: {
    totalCalls: 0,
    uniqueTickers: 0,
    hitRate: { "1m": 0, "3m": 0 },
    hitRateN: { "1m": 0, "3m": 0 },
    avgExcess: { "1w": 0, "1m": 0, "3m": 0, toDate: 0 },
    callsPerWeek: 0,
    best: [],
    worst: [],
  },
  caveats: [],
};
const PRICES_FIXTURE = [{ date: "2026-06-03", o: 1, h: 2, l: 0.5, c: 1.5 }];
const CALLS_INDEX_FIXTURE = [
  {
    handle: "kevvonz",
    shortcode: "abc",
    ticker: "AAA",
    company: "A Co",
    postDate: "2026-06-03",
    isFirstCall: true,
    conviction: 0.8,
    ex3m: null,
    exToDate: null,
    stockToDate: null,
  },
];

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Mock the static-CDN fetch by URL path; throw on any unexpected URL so the test is precise.
function mockFetch(map: Record<string, unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    if (!(path in map)) throw new Error(`unexpected fetch: ${path}`);
    return new Response(JSON.stringify(map[path]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

// Mock every CDN fetch as a 404 to exercise the on-miss fallback branches.
function missFetch() {
  globalThis.fetch = (async () =>
    new Response("Not Found", { status: 404 })) as unknown as typeof fetch;
}

test("GET /api/calls-index static fallback returns CDN index parsing as CallIndexSchema", async () => {
  mockFetch({ "/calls-index.json": CALLS_INDEX_FIXTURE });
  const { Route } = await import("./calls-index");
  const res = await getHandler(Route)({ params: {} });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  const parsed = CallIndexSchema.parse(await res.json());
  expect(parsed.length).toBe(1);
  expect(parsed[0]!.handle).toBe("kevvonz");
});

test("GET /api/dataset/$handle static fallback returns CDN dataset parsing as DatasetSchema", async () => {
  mockFetch({ "/datasets/kevvonz.json": DATASET_FIXTURE });
  const { Route } = await import("./dataset.$handle");
  const res = await getHandler(Route)({ params: { handle: "kevvonz" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  const parsed = DatasetSchema.parse(await res.json());
  expect(parsed.creator.handle).toBe("kevvonz");
});

test("GET /api/prices/$symbol static fallback returns CDN OHLC parsing as PriceFileSchema", async () => {
  mockFetch({ "/prices/SPY.json": PRICES_FIXTURE });
  const { Route } = await import("./prices.$symbol");
  const res = await getHandler(Route)({ params: { symbol: "SPY" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  const parsed = PriceFileSchema.parse(await res.json());
  expect(parsed.length).toBe(1);
});

test("GET /api/prices/$symbol serves [] (200) on a CDN miss", async () => {
  missFetch();
  const { Route } = await import("./prices.$symbol");
  const res = await getHandler(Route)({ params: { symbol: "NOPE" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
  expect(PriceFileSchema.parse(await res.json())).toEqual([]);
});

test("GET /api/dataset/$handle returns upstream status + JSON error on a CDN miss", async () => {
  missFetch();
  const { Route } = await import("./dataset.$handle");
  const res = await getHandler(Route)({ params: { handle: "nope" } });
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toMatchObject({ error: expect.stringContaining("nope") });
});

test("GET /api/dataset/$handle → 404 on an unsafe handle (no upstream fetch)", async () => {
  globalThis.fetch = (async () => {
    throw new Error("must not fetch");
  }) as unknown as typeof fetch;
  const { Route } = await import("./dataset.$handle");
  const res = await getHandler(Route)({ params: { handle: "../secret" } });
  expect(res.status).toBe(404);
});

test("GET /api/prices/$symbol → 404 on an unsafe symbol (no upstream fetch)", async () => {
  globalThis.fetch = (async () => {
    throw new Error("must not fetch");
  }) as unknown as typeof fetch;
  const { Route } = await import("./prices.$symbol");
  const res = await getHandler(Route)({ params: { symbol: "a/b" } });
  expect(res.status).toBe(404);
});

test("GET /api/calls-index returns upstream status + JSON error on a CDN miss", async () => {
  missFetch();
  const { Route } = await import("./calls-index");
  const res = await getHandler(Route)({ params: {} });
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toMatchObject({ error: expect.stringContaining("calls-index") });
});
