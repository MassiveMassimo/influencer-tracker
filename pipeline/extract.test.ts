import { describe, it, expect, test } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./config";
import { formatUploadDate, postDateOf, loadDatasetAnchors } from "./extract";

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

test("postDateOf: store > info.json > dataset anchor; null only when all miss", async () => {
  const handle = `__test_ex_${Date.now()}`;
  const code = "ABC123";
  const rawCodeDir = join(DATA, handle, "raw", code);
  mkdirSync(rawCodeDir, { recursive: true });
  try {
    // info.json on disk says one date...
    writeFileSync(join(rawCodeDir, "x.info.json"), JSON.stringify({ upload_date: "20260101" }));
    // ...but the store says another -> store WINS (reproducibility).
    expect(await postDateOf({ [code]: "2026-03-11" }, {}, handle, code)).toBe("2026-03-11");
    // store miss + info.json present -> info.json value (wins over a dataset anchor).
    expect(await postDateOf({}, { [code]: "2025-12-25" }, handle, code)).toBe("2026-01-01");
    // store miss + info.json absent (raw/ purged) + dataset anchor present -> recover the
    // frozen anchor rather than dropping the reel's calls.
    expect(await postDateOf({}, { NOPE: "2025-11-30" }, handle, "NOPE")).toBe("2025-11-30");
    // store miss + info.json present but no matching dataset anchor -> info.json value.
    expect(await postDateOf({}, {}, handle, code)).toBe("2026-01-01");
    // all miss -> null (skip rather than fabricate).
    expect(await postDateOf({}, {}, handle, "GONE")).toBe(null);
  } finally {
    rmSync(join(DATA, handle), { recursive: true, force: true });
  }
});

test("loadDatasetAnchors: shortcode->postDate from dataset.json calls; fail-open to {}", async () => {
  const handle = `__test_da_${Date.now()}`;
  const dir = join(DATA, handle);
  mkdirSync(dir, { recursive: true });
  try {
    expect(await loadDatasetAnchors(handle)).toEqual({}); // missing dataset.json -> {}
    writeFileSync(
      join(dir, "dataset.json"),
      JSON.stringify({
        calls: [
          { shortcode: "AAA", postDate: "2026-01-02", ticker: "NVDA" },
          { shortcode: "AAA", postDate: "2026-01-02", ticker: "AMD" }, // multi-stock post, same date
          { shortcode: "BBB", postDate: "2026-02-03", ticker: "TSLA" },
          { ticker: "NOPE" }, // no shortcode/postDate -> ignored
        ],
      }),
    );
    expect(await loadDatasetAnchors(handle)).toEqual({ AAA: "2026-01-02", BBB: "2026-02-03" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
