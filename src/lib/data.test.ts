import { test, expect, describe, mock } from "bun:test";

// dataset-source.ts uses import.meta.glob which is Vite-only; stub it out for bun test.
mock.module("./dataset-source", () => ({ loadIndex: () => [] }));
// @tanstack/react-start uses Vite internals too; stub createServerFn.
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: (fn: () => unknown) => fn }),
}));

const { readFromDbOrNull } = await import("./data");

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
