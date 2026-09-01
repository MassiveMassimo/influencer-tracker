import { describe, expect, it } from "bun:test";
import { captionFromInfo, combineTranscript } from "./transcribe";

describe("captionFromInfo", () => {
  it("returns the Instagram description when present", () => {
    expect(captionFromInfo({ description: "My highest-conviction position is $NVDA." })).toBe(
      "My highest-conviction position is $NVDA.",
    );
  });

  it("returns an empty string for missing or non-string descriptions", () => {
    expect(captionFromInfo({})).toBe("");
    expect(captionFromInfo({ description: null })).toBe("");
  });
});

describe("combineTranscript", () => {
  it("keeps both caption and spoken text", () => {
    expect(combineTranscript("Caption call", "Spoken call")).toBe(
      "CAPTION:\nCaption call\n\nAUDIO:\nSpoken call",
    );
  });

  it("supports image-only posts and captionless reels", () => {
    expect(combineTranscript("Image post caption", "")).toBe("CAPTION:\nImage post caption");
    expect(combineTranscript("", "Spoken call")).toBe("AUDIO:\nSpoken call");
  });
});
