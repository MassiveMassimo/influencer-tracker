import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  assertNoDownloadFailures,
  clearDownloadFailure,
  downloadInstagramMedia,
  downloadedMediaFiles,
  hasInstagramSessionCookie,
  instagramCaptionFromTitle,
  loadDownloadFailures,
  loadUnavailableMedia,
  recordDownloadFailure,
  recordUnavailableMedia,
} from "./scrape";
import { creatorDir } from "./config";

test("Instagram login requires a live sessionid, not only a remembered account", () => {
  expect(hasInstagramSessionCookie([{ name: "ds_user_id", value: "123" }])).toBe(false);
  expect(
    hasInstagramSessionCookie([
      { name: "ds_user_id", value: "123" },
      { name: "sessionid", value: "live-session" },
    ]),
  ).toBe(true);
  expect(hasInstagramSessionCookie([{ name: "sessionid", value: "" }])).toBe(false);
});

test("Instagram post helpers keep downloaded media and extract the caption", () => {
  expect(
    downloadedMediaFiles([
      "media.CODE.info.json",
      "image-01.jpg",
      "image-02.webp",
      "media.CODE.mp4",
      "audio.wav",
    ]),
  ).toEqual(["image-01.jpg", "image-02.webp", "media.CODE.mp4"]);
  expect(instagramCaptionFromTitle('Kevin Hu on Instagram: "A bullish caption 📈"')).toBe(
    "A bullish caption 📈",
  );
  expect(instagramCaptionFromTitle("Instagram")).toBe("");
});

// A spawn-level failure (yt-dlp not on PATH) breaks EVERY post — it must throw so the run
// BLOCKs loudly, not silently ingest nothing (the ~10-day data gap on 2026-06-27).
test("downloadInstagramMedia throws when yt-dlp cannot launch (ENOENT)", () => {
  const spawn = () => ({
    status: null,
    error: Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" }),
  });
  expect(() => downloadInstagramMedia("__t", { shortcode: "CODE", kind: "reel" }, spawn)).toThrow(
    /yt-dlp failed to launch/,
  );
});

// yt-dlp ran but exited non-zero: this post remains retryable and blocks completion.
test("downloadInstagramMedia returns a retryable failure when yt-dlp exits non-zero", () => {
  expect(
    downloadInstagramMedia("__t", { shortcode: "CODE", kind: "reel" }, () => ({
      status: 1,
    })),
  ).toEqual({
    ok: false,
    reason: "yt-dlp exited with status 1",
  });
});

test("downloadInstagramMedia returns success when yt-dlp exits zero", () => {
  expect(
    downloadInstagramMedia("__t", { shortcode: "CODE", kind: "reel" }, () => ({
      status: 0,
    })),
  ).toEqual({ ok: true });
});

test("downloadInstagramMedia uses the feed-post URL for image and carousel posts", () => {
  let args: string[] = [];
  downloadInstagramMedia("__t", { shortcode: "POST", kind: "post" }, (_command, given) => {
    args = given;
    return { status: 0 };
  });
  expect(args).toContain("https://www.instagram.com/p/POST/");
});

const FAILURE_HANDLE = "__download_failure_test__";
afterEach(() => rm(creatorDir(FAILURE_HANDLE), { recursive: true, force: true }));

test("download failure ledger keeps retries until the post downloads", async () => {
  await recordDownloadFailure(FAILURE_HANDLE, "RETRY", "reel", "yt-dlp exited with status 1");
  await recordDownloadFailure(FAILURE_HANDLE, "RETRY", "reel", "yt-dlp exited with status 2");
  expect(await loadDownloadFailures(FAILURE_HANDLE)).toMatchObject([
    {
      shortcode: "RETRY",
      kind: "reel",
      attempts: 2,
      lastError: "yt-dlp exited with status 2",
    },
  ]);

  await clearDownloadFailure(FAILURE_HANDLE, "RETRY");
  expect(await loadDownloadFailures(FAILURE_HANDLE)).toEqual([]);
});

test("download stage fails while retryable posts remain", () => {
  expect(() =>
    assertNoDownloadFailures([
      {
        shortcode: "RETRY",
        kind: "reel",
        attempts: 2,
        lastError: "yt-dlp exited with status 1",
        updatedAt: "2026-08-23T00:00:00.000Z",
      },
    ]),
  ).toThrow(/download incomplete: 1 media item/);
  expect(() => assertNoDownloadFailures([])).not.toThrow();
});

test("confirmed unavailable media stays in a durable terminal ledger", async () => {
  await recordUnavailableMedia(FAILURE_HANDLE, "REMOVED", "reel");
  await recordUnavailableMedia(FAILURE_HANDLE, "REMOVED", "reel");
  expect(await loadUnavailableMedia(FAILURE_HANDLE)).toMatchObject([
    {
      shortcode: "REMOVED",
      kind: "reel",
    },
  ]);
});
