import { describe, it, expect } from "bun:test";
import { toRecord, isRateLimit } from "./scrape-x";

describe("toRecord", () => {
  it("keeps PHOTO media (Rettiwt's uppercase enum), drops video", () => {
    // Real Rettiwt shape: media[].type is the MediaType enum ("PHOTO"/"VIDEO").
    // The video URL has no image extension, so it is excluded by type alone.
    const rec = toRecord({
      id: 123, fullText: "buy NBIS",
      createdAt: "2026-01-15T10:00:00.000Z",
      media: [
        { type: "PHOTO", url: "https://pbs.twimg.com/media/a.jpg" },
        { type: "VIDEO", url: "https://video.twimg.com/clip/v.mp4" },
      ],
    });
    expect(rec).toEqual({
      id: "123", text: "buy NBIS",
      createdAt: "2026-01-15T10:00:00.000Z",
      imageUrls: ["https://pbs.twimg.com/media/a.jpg"],
    });
  });
  it("detects a PHOTO even when its URL lacks an extension", () => {
    const rec = toRecord({
      id: 5, createdAt: "2026-01-15T00:00:00.000Z",
      media: [{ type: "PHOTO", url: "https://pbs.twimg.com/media/noext?format=jpg" }],
    });
    expect(rec.imageUrls).toEqual(["https://pbs.twimg.com/media/noext?format=jpg"]);
  });
  it("handles missing media and text", () => {
    const rec = toRecord({ id: 9, createdAt: "2026-01-15T00:00:00.000Z" });
    expect(rec).toEqual({ id: "9", text: "", createdAt: "2026-01-15T00:00:00.000Z", imageUrls: [] });
  });
});

describe("isRateLimit", () => {
  it("detects rate-limit errors", () => {
    expect(isRateLimit(new Error("Too many requests (429)"))).toBe(true);
    expect(isRateLimit(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimit(new Error("not found"))).toBe(false);
  });
});
