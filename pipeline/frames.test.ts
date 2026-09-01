import { expect, test } from "bun:test";
import { sourceImageFiles } from "./frames";

test("sourceImageFiles keeps downloaded post images and excludes generated video frames", () => {
  expect(
    sourceImageFiles([
      "media.one.jpg",
      "media.two.webp",
      "media.three.png",
      "reel.mp4",
      "post.info.json",
      "f_0.25.jpg",
    ]),
  ).toEqual(["media.one.jpg", "media.two.webp", "media.three.png"]);
});
