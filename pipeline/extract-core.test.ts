import { describe, it, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dedupeCalls, callKey, extractPosts } from "./extract-core";
import { creatorDir } from "./config";
import type { ReelCall } from "../src/lib/types";

describe("callKey", () => {
  it("combines shortcode and ticker", () => {
    expect(callKey({ shortcode: "t1", ticker: "NVDA" } as ReelCall)).toBe("t1:NVDA");
  });
});

describe("dedupeCalls", () => {
  const mk = (shortcode: string, ticker: string): ReelCall => ({
    shortcode,
    postDate: "2026-01-01",
    ticker,
    company: "",
    direction: "bullish",
    isExplicitBuy: true,
    conviction: 0.5,
    quote: "",
    onScreenPrice: null,
    summary: "",
  });
  it("keeps the first occurrence and drops later duplicates by (shortcode, ticker)", () => {
    const out = dedupeCalls([mk("t1", "AAA"), mk("t1", "AAA"), mk("t2", "CCC")]);
    expect(out.map((c) => `${c.shortcode}:${c.ticker}`)).toEqual(["t1:AAA", "t2:CCC"]);
  });
  it("keeps two different tickers on the same post (multi-stock)", () => {
    const out = dedupeCalls([mk("t1", "AAA"), mk("t1", "BBB")]);
    expect(out.map((c) => c.ticker)).toEqual(["AAA", "BBB"]);
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeCalls([])).toEqual([]);
  });
});

// Uses a throwaway creator dir under data/creators/ (creatorDir/writeCalls are not
// path-injectable); cleaned up after each test.
describe("extractPosts seed persistence", () => {
  const HANDLE = "__extract_seed_test__";
  const dir = creatorDir(HANDLE);
  const donePath = join(dir, "extract-done.json");

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const existingCall: ReelCall = {
    shortcode: "a",
    postDate: "2026-01-01",
    ticker: "NVDA",
    company: "",
    direction: "bullish",
    isExplicitBuy: true,
    conviction: 0.5,
    quote: "",
    onScreenPrice: null,
    summary: "",
  };

  const buildPost = async (sc: string) => ({ shortcode: sc, postDate: "2026-01-01", body: sc });

  it("seeds done only from posts with a call, classifying uncalled/swallowed posts once", async () => {
    await mkdir(dir, { recursive: true });
    // "a" produced a call; "x" was scraped but never classified (no call recorded).
    await writeFile(join(dir, "reel-calls.json"), JSON.stringify([existingCall]));

    const seen: string[] = [];
    const classifyFn = async (body: string) => {
      seen.push(body);
      return [];
    };
    // Seed run: "a" is frozen (already called), "x" flows through classification.
    await extractPosts(HANDLE, ["a", "x"], buildPost, { concurrency: 4, donePath, classifyFn });
    expect(seen).toEqual(["x"]);
    expect(existsSync(donePath)).toBe(true);
  });

  it("persists the seed so the next run classifies only newly-scraped posts (regression)", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "reel-calls.json"), JSON.stringify([existingCall]));

    const seen: string[] = [];
    const classifyFn = async (body: string) => {
      seen.push(body);
      return [];
    };
    const opts = { concurrency: 4, donePath, classifyFn };

    // Run 1 (seed): only called posts exist → pending empty → classify nothing, but
    // still PERSIST the done file. Without the fix the early return skips this write.
    await extractPosts(HANDLE, ["a"], buildPost, opts);
    expect(existsSync(donePath)).toBe(true);
    expect(seen).toEqual([]);

    // Run 2: a new post "b" was scraped since. It must be the only one classified —
    // on the buggy code the missing seed file makes run 2 re-seed and swallow "b".
    await extractPosts(HANDLE, ["a", "b"], buildPost, opts);
    expect(seen).toEqual(["b"]);
  });
});

describe("extractPosts failure ledger", () => {
  const HANDLE = "__extract_failure_test__";
  const dir = creatorDir(HANDLE);
  const donePath = join(dir, "extract-done.json");
  const failurePath = join(dir, "extract-failures.json");
  const buildPost = async (sc: string) => ({
    shortcode: sc,
    postDate: "2026-01-01",
    body: sc,
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("fails the stage and records a retryable classifier failure", async () => {
    await mkdir(dir, { recursive: true });

    await expect(
      extractPosts(HANDLE, ["broken"], buildPost, {
        concurrency: 1,
        donePath,
        failurePath,
        classifyFn: async () => {
          throw new Error("invalid classifier payload");
        },
      }),
    ).rejects.toThrow(/extraction incomplete: 1 post/);

    const failures = JSON.parse(await readFile(failurePath, "utf8"));
    expect(failures).toMatchObject([
      {
        shortcode: "broken",
        attempts: 1,
        lastError: "invalid classifier payload",
      },
    ]);
  });

  it("clears the failure after a later retry succeeds", async () => {
    await mkdir(dir, { recursive: true });
    const opts = {
      concurrency: 1,
      donePath,
      failurePath,
      classifyFn: async () => {
        throw new Error("temporary failure");
      },
    };
    await expect(extractPosts(HANDLE, ["retry"], buildPost, opts)).rejects.toThrow();

    await extractPosts(HANDLE, ["retry"], buildPost, {
      ...opts,
      classifyFn: async () => [],
    });

    expect(JSON.parse(await readFile(failurePath, "utf8"))).toEqual([]);
    expect(JSON.parse(await readFile(donePath, "utf8"))).toEqual(["retry"]);
  });

  it("keeps a post pending when its adapter cannot build extractable input", async () => {
    await mkdir(dir, { recursive: true });

    await expect(
      extractPosts(HANDLE, ["dateless"], async () => null, {
        concurrency: 1,
        donePath,
        failurePath,
        classifyFn: async () => [],
      }),
    ).rejects.toThrow(/extraction incomplete/);

    expect(JSON.parse(await readFile(donePath, "utf8"))).toEqual([]);
    expect(JSON.parse(await readFile(failurePath, "utf8"))[0]).toMatchObject({
      shortcode: "dateless",
      lastError: "adapter returned no extractable post",
    });
  });
});
