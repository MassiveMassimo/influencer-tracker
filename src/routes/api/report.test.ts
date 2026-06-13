import { test, expect } from "bun:test";
import { validateReportBody, reporterHashOf } from "./report";

test("rejects unknown reason and missing fields", () => {
  expect(validateReportBody({ handle: "h", shortcode: "a", reason: "spam" })).toBeNull();
  expect(validateReportBody({ handle: "h", reason: "other" })).toBeNull();
  expect(validateReportBody({ handle: "h", shortcode: "a", reason: "other" })).toEqual({ handle: "h", shortcode: "a", reason: "other" });
});

test("over-long handle/shortcode rejected (bound the write)", () => {
  expect(validateReportBody({ handle: "x".repeat(200), shortcode: "a", reason: "other" })).toBeNull();
});

test("reporterHash is stable for same ip+salt, differs across salts, and leaks no raw ip", () => {
  const a = reporterHashOf("1.2.3.4", "salt1");
  expect(reporterHashOf("1.2.3.4", "salt1")).toBe(a);
  expect(reporterHashOf("1.2.3.4", "salt2")).not.toBe(a);
  expect(a).not.toContain("1.2.3.4");
});
