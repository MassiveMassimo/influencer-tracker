import { afterEach, expect, test } from "bun:test";
import { siteUrl } from "./site";

const originalVercelUrl = process.env.VERCEL_URL;
const hadWindow = "window" in globalThis;
const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  process.env.VERCEL_URL = originalVercelUrl;
  if (hadWindow) {
    (globalThis as { window?: unknown }).window = originalWindow;
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("uses the current Vercel deployment origin when no explicit site URL is configured", () => {
  delete (globalThis as { window?: unknown }).window;
  process.env.VERCEL_URL = "influencer-tracker-preview.vercel.app";

  expect(siteUrl("/api/calls-index")).toBe(
    "https://influencer-tracker-preview.vercel.app/api/calls-index",
  );
});
