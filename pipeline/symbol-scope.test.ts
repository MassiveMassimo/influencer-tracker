import { test, expect } from "bun:test";
import { isOutOfScope } from "./symbol-scope";

test("excluded fund/index/derivative types are out of scope", () => {
  // ECNQUOTE: Yahoo's "no clean primary listing" type (e.g. bare VFV) — not scorable.
  for (const t of ["ETF", "MUTUALFUND", "INDEX", "CURRENCY", "FUTURE", "OPTION", "ECNQUOTE"]) {
    expect(isOutOfScope(t)).toBe(true);
  }
});

test("individual securities (equity, crypto) stay in scope", () => {
  expect(isOutOfScope("EQUITY")).toBe(false);
  expect(isOutOfScope("CRYPTOCURRENCY")).toBe(false);
});

test("unknown/empty type fails open (kept) — never silently drop a real call", () => {
  expect(isOutOfScope("")).toBe(false);
  expect(isOutOfScope(undefined)).toBe(false);
  expect(isOutOfScope("SOMETHING_NEW")).toBe(false);
});
