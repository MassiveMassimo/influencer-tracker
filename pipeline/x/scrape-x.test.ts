import { describe, it, expect } from "bun:test";
import { toRecord, isRateLimit } from "./scrape-x";

describe("toRecord", () => {
  it("maps id, text, ISO date, and photo URLs", () => {
    const rec = toRecord({
      id: 123, fullText: "buy NBIS",
      createdAt: "2026-01-15T10:00:00.000Z",
      media: [
        { type: "photo", url: "https://x/a.jpg" },
        { type: "video", url: "https://x/v.mp4" },
      ],
    });
    expect(rec).toEqual({
      id: "123", text: "buy NBIS",
      createdAt: "2026-01-15T10:00:00.000Z",
      imageUrls: ["https://x/a.jpg"],
    });
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
