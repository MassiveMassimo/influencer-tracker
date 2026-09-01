import { expect, test } from "bun:test";
import { saveAvatar } from "./avatar";

test("saveAvatar stops waiting when the optional CDN request times out", async () => {
  const neverResponds = (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });

  const started = performance.now();
  expect(
    await saveAvatar("__avatar_timeout_test__", "https://example.com/avatar", neverResponds, 5),
  ).toBeNull();
  expect(performance.now() - started).toBeLessThan(250);
});
