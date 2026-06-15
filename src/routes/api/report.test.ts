import { test, expect } from "bun:test";
import { validateReportBody, reporterHashOf } from "./report";

test("rejects unknown reason and missing fields", () => {
  expect(validateReportBody({ handle: "h", shortcode: "a", ticker: "AAPL", reason: "spam" })).toBeNull();
  expect(validateReportBody({ handle: "h", ticker: "AAPL", reason: "other" })).toBeNull();
  expect(validateReportBody({ handle: "h", shortcode: "a", reason: "other" })).toBeNull(); // missing ticker
  expect(validateReportBody({ handle: "h", shortcode: "a", ticker: "AAPL", reason: "other" })).toEqual({ handle: "h", shortcode: "a", ticker: "AAPL", reason: "other" });
});

test("over-long handle/shortcode/ticker rejected (bound the write)", () => {
  expect(validateReportBody({ handle: "x".repeat(200), shortcode: "a", ticker: "AAPL", reason: "other" })).toBeNull();
  expect(validateReportBody({ handle: "h", shortcode: "a", ticker: "x".repeat(40), reason: "other" })).toBeNull();
});

test("reporterHash is stable for same ip+salt, differs across salts, and leaks no raw ip", () => {
  const a = reporterHashOf("1.2.3.4", "salt1");
  expect(reporterHashOf("1.2.3.4", "salt1")).toBe(a);
  expect(reporterHashOf("1.2.3.4", "salt2")).not.toBe(a);
  expect(a).not.toContain("1.2.3.4");
});
