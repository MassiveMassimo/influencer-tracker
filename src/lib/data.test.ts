import { test, expect, describe, mock, afterEach } from "bun:test";

// dataset-source.ts uses import.meta.glob which is Vite-only; stub it out for bun test.
mock.module("./dataset-source", () => ({ loadIndex: () => [] }));
// @tanstack/react-start uses Vite internals too; stub createServerFn.
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      inputValidator: () => b,
      middleware: () => b,
      handler: (fn: unknown) => fn,
    };
    return b;
  },
}));

const { readFromDbOrNull, fetchDataset, fetchPrices } = await import("./data");

// The server-side branch requires no `window` and USE_DB=1. A DOM-providing test file in the
// same `bun test` run can leave `window` defined, so the catch/success tests delete it for
// their duration (and restore) rather than assuming the bare bun env.
function withServerEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevUseDb = process.env.USE_DB;
  const hadWindow = "window" in globalThis;
  const prevWindow = (globalThis as { window?: unknown }).window;
  process.env.USE_DB = "1";
  delete (globalThis as { window?: unknown }).window;
  return fn().finally(() => {
    process.env.USE_DB = prevUseDb;
    if (hadWindow) (globalThis as { window?: unknown }).window = prevWindow;
  });
}

describe("readFromDbOrNull", () => {
  test("returns null when not SSR or USE_DB off (no DB import attempted)", async () => {
    // In bun test env import.meta.env.SSR is undefined and USE_DB unset → null, no throw.
    expect(await readFromDbOrNull("t", async () => "x")).toBeNull();
  });

  test("returns null on DB error (catch swallows, does not throw)", async () => {
    await withServerEnv(async () => {
      expect(
        await readFromDbOrNull("t", async () => {
          throw new Error("neon 500");
        }),
      ).toBeNull();
    });
  });

  test("returns the read value when USE_DB=1 and no window", async () => {
    await withServerEnv(async () => {
      expect(await readFromDbOrNull("t", async () => "payload")).toBe("payload");
    });
  });
});

// Primary-fetch (API route) vs catch-fallback (static asset) wiring. With USE_DB unset, the
// SSR/DB branch returns null and these fetchers fall straight into the API-route fetch — so a
// mocked global.fetch exercises the real primary/fallback control flow (no DB, no Vite).
describe("fetcher fallback asymmetry", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const minimalDataset = {
    creator: { handle: "h", name: "H" },
    generatedAt: "2026-01-01T00:00:00Z",
    spyAnchor: "2026-01-01",
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

  // fetchPrices: a non-OK /api/prices/* returns [] WITHOUT a second (static) fetch — the
  // deliberate asymmetry. (A non-OK is a true upstream error; static would also miss.)
  test("fetchPrices: non-OK API → [] with no static retry", async () => {
    const calls: string[] = [];
    global.fetch = mock(async (url: string) => {
      calls.push(String(url));
      return new Response("err", { status: 500 });
    }) as unknown as typeof fetch;

    expect(await fetchPrices("AAPL")).toEqual([]);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("/api/prices/AAPL");
    expect(calls.some((u) => u.includes("/prices/AAPL.json"))).toBe(false);
  });

  // fetchDataset: a non-OK /api/dataset/* throws inside try → catch retries the static
  // /datasets/*.json path (two fetches, second is the static asset).
  test("fetchDataset: non-OK API → retries static /datasets path", async () => {
    const calls: string[] = [];
    global.fetch = mock(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/api/dataset/")) return new Response("err", { status: 500 });
      return new Response(JSON.stringify(minimalDataset), { status: 200 });
    }) as unknown as typeof fetch;

    const ds = await fetchDataset("h");
    expect(ds.generatedAt).toBe("2026-01-01T00:00:00Z");
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("/api/dataset/h");
    expect(calls[1]).toContain("/datasets/h.json");
  });
});
