import { describe, it, expect } from "bun:test";
import { withRetry } from "./retry";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; return 42; });
    expect(r).toBe(42);
    expect(calls).toBe(1);
  });

  it("retries retryable errors then succeeds", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => { calls++; if (calls < 3) throw new Error("rate limit"); return "ok"; },
      { retries: 5, delayMs: () => 0, isRetryable: (e) => String(e).includes("rate") },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  it("stops on non-retryable error", async () => {
    let calls = 0;
    await expect(withRetry(
      async () => { calls++; throw new Error("fatal"); },
      { retries: 5, delayMs: () => 0, isRetryable: (e) => String(e).includes("rate") },
    )).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("gives up after retries exhausted", async () => {
    let calls = 0;
    await expect(withRetry(
      async () => { calls++; throw new Error("rate limit"); },
      { retries: 2, delayMs: () => 0 },
    )).rejects.toThrow("rate limit");
    expect(calls).toBe(3);
  });
});
