import { test, expect } from "bun:test";
import { downloadReel } from "./scrape";

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
test("downloadReel returns false when yt-dlp runs but finds no video", () => {
  expect(downloadReel("__t", "CODE", () => ({ status: 1 }))).toBe(false);
});

test("downloadReel returns true on a successful download", () => {
  expect(downloadReel("__t", "CODE", () => ({ status: 0 }))).toBe(true);
});
