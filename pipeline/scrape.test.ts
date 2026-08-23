import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  assertNoDownloadFailures,
  clearDownloadFailure,
  downloadReel,
  loadDownloadFailures,
  recordDownloadFailure,
} from "./scrape";
import { creatorDir } from "./config";

// A spawn-level failure (yt-dlp not on PATH) breaks EVERY reel — it must throw so the run
// BLOCKs loudly, not silently ingest nothing (the ~10-day data gap on 2026-06-27).
test("downloadReel throws when yt-dlp cannot launch (ENOENT)", () => {
  const spawn = () => ({
    status: null,
    error: Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" }),
  });
  expect(() => downloadReel("__t", "CODE", spawn)).toThrow(/yt-dlp failed to launch/);
});

// yt-dlp ran but exited non-zero: this reel has no downloadable video (image/carousel post).
// Benign and per-reel — return false so the caller skips and continues.
test("downloadReel returns a retryable failure when yt-dlp exits non-zero", () => {
  expect(downloadReel("__t", "CODE", () => ({ status: 1 }))).toEqual({
    ok: false,
    reason: "yt-dlp exited with status 1",
  });
});

test("downloadReel returns success when yt-dlp exits zero", () => {
  expect(downloadReel("__t", "CODE", () => ({ status: 0 }))).toEqual({ ok: true });
});

const FAILURE_HANDLE = "__download_failure_test__";
afterEach(() => rm(creatorDir(FAILURE_HANDLE), { recursive: true, force: true }));

test("download failure ledger keeps retries until the reel downloads", async () => {
  await recordDownloadFailure(FAILURE_HANDLE, "RETRY", "yt-dlp exited with status 1");
  await recordDownloadFailure(FAILURE_HANDLE, "RETRY", "yt-dlp exited with status 2");
  expect(await loadDownloadFailures(FAILURE_HANDLE)).toMatchObject([
    {
      shortcode: "RETRY",
      attempts: 2,
      lastError: "yt-dlp exited with status 2",
    },
  ]);

  await clearDownloadFailure(FAILURE_HANDLE, "RETRY");
  expect(await loadDownloadFailures(FAILURE_HANDLE)).toEqual([]);
});

test("download stage fails while retryable reels remain", () => {
  expect(() =>
    assertNoDownloadFailures([
      {
        shortcode: "RETRY",
        attempts: 2,
        lastError: "yt-dlp exited with status 1",
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
    ]),
  ).toThrow(/download incomplete: 1 reel/);
  expect(() => assertNoDownloadFailures([])).not.toThrow();
});
