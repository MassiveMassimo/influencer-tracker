import { describe, it, expect } from "bun:test";
import { formatUploadDate } from "./extract";

describe("formatUploadDate", () => {
  it("formats a valid YYYYMMDD", () => {
    expect(formatUploadDate("20260601")).toBe("2026-06-01");
  });
  it("returns null for a missing date", () => {
    expect(formatUploadDate(undefined)).toBeNull();
  });
  it("returns null for a malformed date", () => {
    expect(formatUploadDate("2026-06")).toBeNull();
    expect(formatUploadDate("garbage")).toBeNull();
  });
});
