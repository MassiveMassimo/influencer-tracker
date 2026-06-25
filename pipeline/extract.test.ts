import { describe, it, expect, test } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./config";
import { formatUploadDate, postDateOf } from "./extract";

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

test("postDateOf: durable store wins over info.json; falls back when absent", async () => {
  const handle = `__test_ex_${Date.now()}`;
  const code = "ABC123";
  const rawCodeDir = join(DATA, handle, "raw", code);
  mkdirSync(rawCodeDir, { recursive: true });
  try {
    // info.json on disk says one date...
    writeFileSync(join(rawCodeDir, "x.info.json"), JSON.stringify({ upload_date: "20260101" }));
    // ...but the store says another -> store WINS (reproducibility).
    expect(await postDateOf({ [code]: "2026-03-11" }, handle, code)).toBe("2026-03-11");
    // store miss + info.json present -> info.json value
    expect(await postDateOf({}, handle, code)).toBe("2026-01-01");
    // store miss + info.json absent -> null
    expect(await postDateOf({}, handle, "NOPE")).toBe(null);
  } finally {
    rmSync(join(DATA, handle), { recursive: true, force: true });
  }
});
