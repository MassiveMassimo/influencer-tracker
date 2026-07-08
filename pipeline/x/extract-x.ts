import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawDir } from "../config";
import { fireworks, FIREWORKS_MODEL, FIREWORKS_VISION_MODEL } from "../fireworks";
import { classify, toReelCalls, type Classification } from "../calls";
import { readImageCached, type FrameHint } from "../vision";
import { extractPosts, type ExtractPost, type BuildPost } from "../extract-core";
import type { TweetRecord } from "./scrape-x";
import type { ReelCall } from "../../src/lib/types";

export function tweetDate(createdAt: string): string {
  return new Date(createdAt).toISOString().slice(0, 10);
}

export interface ExtractDeps {
  text: string;
  vision: string;
  classifyFn: (textModel: string, body: string) => Promise<Classification[]>;
  readImageFn: (vision: string, imgPath: string) => Promise<FrameHint>;
}

// Build an ExtractPost from a tweet (resolves image hints, builds body). The core
// handles classification + ReelCall mapping; this is the X-specific post builder.
export async function buildTweetPost(
  t: TweetRecord,
  handle: string,
  deps: Pick<ExtractDeps, "readImageFn" | "vision">,
): Promise<ExtractPost> {
  const dir = join(rawDir(handle), t.id);
  let hints: FrameHint[] = [];
  if (existsSync(dir)) {
    const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
    hints = await Promise.all(files.map((f) => deps.readImageFn(deps.vision, join(dir, f))));
  }
  const body = `TWEET:\n${t.text}\n\nIMAGE HINTS:\n${JSON.stringify(hints)}`;
  return { shortcode: t.id, postDate: tweetDate(t.createdAt), body };
}

// Convenience wrapper: build post + classify + map to ReelCalls. Kept for tests
// that verify the full per-tweet flow (toReelCalls itself is tested in calls.test.ts).
export async function tweetToReelCalls(
  t: TweetRecord,
  handle: string,
  deps: ExtractDeps,
): Promise<ReelCall[]> {
  const post = await buildTweetPost(t, handle, deps);
  const cs = await deps.classifyFn(deps.text, post.body);
  return toReelCalls(cs, post.shortcode, post.postDate);
}

export async function extractX(handle: string) {
  // Whole X path runs on Fireworks (no Groq throttling at this scale): text via
  // deepseek-v4-flash, image hints via minimax-m3.
  const deps: ExtractDeps = {
    text: FIREWORKS_MODEL,
    vision: FIREWORKS_VISION_MODEL,
    classifyFn: (m, b) => classify(m, b, fireworks),
    readImageFn: (m, p) => readImageCached(m, p, fireworks),
  };
  const tweets: TweetRecord[] = JSON.parse(
    await readFile(join(rawDir(handle), "tweets.json"), "utf8"),
  );
  const shortcodes = tweets.map((t) => t.id);
  const tweetsById = new Map(tweets.map((t) => [t.id, t]));

  const buildPost: BuildPost = async (shortcode: string): Promise<ExtractPost | null> => {
    const t = tweetsById.get(shortcode);
    if (!t) return null;
    return buildTweetPost(t, handle, deps);
  };

  // extract-done.json lives in raw/ (gitignored) — consistent with tweets.json as the
  // incremental cursor. If raw/ is purged, a full re-extract is expected (same as the
  // forward-scrape anchor behavior).
  await extractPosts(handle, shortcodes, buildPost, {
    concurrency: Number(process.env.X_EXTRACT_CONCURRENCY) || 96,
    donePath: join(rawDir(handle), "extract-done.json"),
    classifyFn: (body) => classify(deps.text, body, fireworks),
  });
}
