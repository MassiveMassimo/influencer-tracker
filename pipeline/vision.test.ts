import { describe, it, expect, mock } from "bun:test";

// Mock groq so config.ts (which uses Bun-only import.meta.dir) is never loaded.
mock.module("./groq", () => ({ groq: mock(), discoverModels: mock() }));

import { parseHint } from "./vision";

describe("parseHint", () => {
  it("parses clean JSON", () => {
    expect(parseHint('{"ticker":"NBIS","price":65.1}')).toEqual({ ticker: "NBIS", price: 65.1 });
  });
  it("strips code fences", () => {
    expect(parseHint('```json\n{"ticker":"AAPL","price":null}\n```')).toEqual({ ticker: "AAPL", price: null });
  });
  it("falls back to nulls on garbage", () => {
    expect(parseHint("not json")).toEqual({ ticker: null, price: null });
  });
});
